import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertNetwork, networkConfig, rpc } from './rpc.js';
import { ElectrumProvider, type HistoryEntry } from './electrum.js';
import { verifyRegistryGenesis } from './genesis.js';
import { type VaultConfig, contracts, contract, utxo, transitionWitness, termsFor, json } from './arena.js';
import { hashState, nextState, remainingCommitment, STATE_SIZE } from './registry.js';

export interface Allocation { id: string; terms: string; output: any; withdrawal?: string }
export interface VaultState { config: VaultConfig; category: string; witness: string; transaction: any; history: { txid: string; height: number; action: number; slot: number; period: number; witness: string }[]; allocations: Allocation[] }
export interface Block { height: number; hash: string; parent?: string; mtp: number; transactions: any[] }
interface Checkpoint { network?: string; version: number; configs: VaultConfig[]; blocks: Block[] }
/** One writer per checkpoint; independent keepers use separate checkpoint paths. */
export class Indexer {
  blocks: Block[] = [];
  vaults: VaultState[] = [];
  health = { connected: false, error: '', updatedAt: '', stale: true, syncing: false, provider: 'bchn', endpoint: '', unconfirmed: [] as string[] };
  private busy = false;
  constructor(readonly configs: VaultConfig[], readonly path?: string, readonly electrum?: ElectrumProvider) {
    if (electrum) {
      if (networkConfig().network !== 'chipnet') throw Error('Electrum indexer is chipnet-only');
      this.health.provider = 'electrum';
    }
  }
  get tip() { return this.blocks.at(-1); }
  async load() {
    if (!this.path) return;
    try {
      const saved: Checkpoint = JSON.parse(await readFile(this.path, 'utf8'));
      if ((saved.network ?? 'regtest') !== networkConfig().network) throw Error('Checkpoint network mismatch');
      if (saved.version !== (this.electrum ? 2 : 1) || json(saved.configs) !== json(this.configs)) throw Error('Checkpoint configuration mismatch');
      this.blocks = saved.blocks;
      // Rebuild only after active-chain reconciliation in sync().
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  private async project(blocks: Block[], read?: (id: string) => Promise<any>) {
    const vaults: VaultState[] = [];
    const admitted = new Map<string, Awaited<ReturnType<typeof contracts>>>();
    for (const block of blocks) for (const tx of block.transactions) {
      for (const config of this.configs.filter(c => c.genesis === tx.txid)) {
        const verified = await verifyRegistryGenesis(config.genesis, config, read, this.electrum);
        const cs = await contracts(config, verified.category, this.electrum);
        admitted.set(verified.category, cs);
        vaults.push({ config, category: verified.category, witness: Buffer.alloc(STATE_SIZE).toString('hex'), transaction: tx, history: [], allocations: [] });
      }
      for (const vault of vaults) {
        for (const allocation of vault.allocations) if (tx.vin.some((i: any) => `${i.txid}:${i.vout}` === allocation.id)) {
          if (allocation.withdrawal && allocation.withdrawal !== tx.txid) throw Error('Duplicate allocation spend');
          allocation.withdrawal = tx.txid;
        }
        if (tx.txid === vault.transaction.txid) continue;
        if (!tx.vin.some((i: any) => i.txid === vault.transaction.txid && i.vout === 0)) continue;
        if (tx.vin[0].txid !== vault.transaction.txid || tx.vin[0].vout !== 0 || tx.vin[1]?.txid !== vault.transaction.txid || tx.vin[1]?.vout !== 1) throw Error('Broken canonical lineage');
        const w = transitionWitness(tx.vin[0].scriptSig.hex);
        if (w.state.toString('hex') !== vault.witness || w.action < 0 || w.action > 5 || w.slot > 15) throw Error('State preimage mismatch');
        const next = nextState(w.state, w.action, w.slot, w.record), cs = admitted.get(vault.category)!;
        const state = tx.vout[0], pool = tx.vout[1], amount = remainingCommitment(next);
        if (state.scriptPubKey.hex !== cs.registry.lockingBytecode || state.tokenData?.category !== vault.category
          || state.tokenData.nft?.capability !== 'mutable' || state.tokenData.nft.commitment !== hashState(next)
          || pool.scriptPubKey.hex !== cs.pool.lockingBytecode || BigInt(pool.tokenData?.amount ?? 0) !== amount
          || (amount > 0n && pool.tokenData?.category !== vault.config.stakingCategory)) throw Error('Indexed covenant output mismatch');
        if (w.action === 3) {
          const terms = termsFor(vault.config, vault.category, w.state, w.slot);
          const allocation = await contract('StakeAllocation', [terms], this.electrum);
          if (tx.vout[3]?.scriptPubKey.hex !== allocation.lockingBytecode) throw Error('Allocation terms mismatch');
          vault.allocations.push({ id: `${tx.txid}:3`, terms: terms.toString('hex'), output: tx.vout[3] });
        }
        vault.history.push({ txid: tx.txid, height: block.height, action: w.action, slot: w.slot, period: w.state.readUInt32LE(0), witness: w.state.toString('hex') });
        vault.witness = next.toString('hex'); vault.transaction = tx;
      }
    }
    return vaults;
  }
  async sync() {
    if (this.busy) throw Error('Index sync already running');
    this.busy = true;
    this.health.syncing = true;
    try {
      if (this.electrum) { await this.electrum.session(() => this.syncElectrum()); return; }
      await assertNetwork(networkConfig().network === 'chipnet');
      const info = await rpc('getblockchaininfo');
      const candidate = this.blocks.slice();
      while (candidate.length && (candidate.at(-1)!.height > info.blocks || await rpc('getblockhash', [candidate.at(-1)!.height]) !== candidate.at(-1)!.hash)) candidate.pop();
      // Retain relevant transactions only, but every block hash for arbitrary-depth rollback.
      const tracked = new Set(this.configs.map(c => c.genesis));
      for (const block of candidate) for (const tx of block.transactions) tracked.add(tx.txid);
      let firstHeight = candidate.at(-1) ? candidate.at(-1)!.height + 1 : 0;
      // An empty registry has no historical transactions to project. Start at tip.
      if (!this.configs.length) { candidate.length = 0; firstHeight = info.blocks; }
      if (!candidate.length && this.configs.length) {
        const heights = await Promise.all(this.configs.map(async c => {
          const tx = await rpc('getrawtransaction', [c.genesis, true]);
          return tx.confirmations > 0 ? (await rpc('getblockheader', [tx.blockhash])).height : 0;
        }));
        firstHeight = Math.min(...heights);
      }
      for (let height = firstHeight; height <= info.blocks; height++) {
        const hash = await rpc<string>('getblockhash', [height]);
        const b = await rpc('getblock', [hash, 2]);
        if (candidate.length && b.previousblockhash !== candidate.at(-1)!.hash) throw Error('Chain changed during indexing; retry');
        // BCH CTOR orders transaction IDs, so children may precede parents in a block.
        const pending = new Map<string, any>(b.tx.map((tx: any) => [tx.txid, tx]));
        const ordered: any[] = [];
        const visit = (tx: any) => {
          if (!pending.delete(tx.txid)) return;
          for (const input of tx.vin) { const parent = pending.get(input.txid); if (parent) visit(parent); }
          ordered.push(tx);
        };
        for (const tx of b.tx) visit(tx);
        const transactions = ordered.filter((tx: any) => {
          const relevant = tracked.has(tx.txid) || tx.vin.some((i: any) => tracked.has(i.txid));
          if (relevant) tracked.add(tx.txid);
          return relevant;
        });
        candidate.push({ height, hash, parent: b.previousblockhash, mtp: b.mediantime, transactions });
      }
      const vaults = await this.project(candidate);
      if ((await rpc('getblockchaininfo')).bestblockhash !== candidate.at(-1)?.hash) throw Error('Chain changed during projection; retry');
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try { await file.writeFile(json({ version: 1, network: networkConfig().network, configs: this.configs, blocks: candidate })); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.path);
        const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      }
      this.blocks = candidate; this.vaults = vaults;
      this.health = { ...this.health, connected: true, stale: false, error: '', updatedAt: new Date().toISOString() };
    } catch (e) {
      this.health = { ...this.health, connected: false, stale: true, error: String(e) }; throw e;
    } finally { this.busy = false; this.health.syncing = false; }
  }
  /** Re-read histories and proofs on each pass. Durable state is never trusted after restart/reorg. */
  private async syncElectrum() {
    const p = this.electrum!, tip = await p.tip();
    const transactions = new Map<string, any>(), histories = new Map<string, HistoryEntry[]>();
    const unconfirmed = new Set<string>();
    const readHistory = async (script: string) => {
      if (histories.has(script)) return;
      const entries = await p.history(script); histories.set(script, entries);
      for (const h of entries) {
        if (h.height <= 0) { unconfirmed.add(h.tx_hash); continue; }
        if (h.height > tip.height) throw Error('History ahead of tip');
        const existing = transactions.get(h.tx_hash);
        if (existing && existing.height !== h.height) throw Error('Inconsistent history height');
        if (!existing) transactions.set(h.tx_hash, await p.transaction(h.tx_hash, h.height));
      }
    };
    for (const config of this.configs) {
      const genesis = await p.transactionStatus(config.genesis);
      if (!genesis.confirmations) throw Error('Configured genesis is unconfirmed');
      transactions.set(genesis.txid, genesis);
      const category = genesis.vin[0]?.txid;
      if (!category) throw Error('Malformed genesis');
      const cs = await contracts(config, category, p);
      await readHistory(cs.registry.lockingBytecode);
      await readHistory(cs.pool.lockingBytecode);
      if (!histories.get(cs.registry.lockingBytecode)!.some(h => h.tx_hash === config.genesis && h.height === genesis.height)) throw Error('Genesis absent from registry history');
    }
    const read = async (id: string) => transactions.get(id) ?? p.transactionStatus(id);
    const build = async (): Promise<Block[]> => {
      // Topological order is authoritative within a block (BCH uses CTOR, not registration order).
      const ordered: any[] = [], visiting = new Set<string>(), done = new Set<string>();
      const visit = (tx: any) => {
        if (done.has(tx.txid)) return;
        if (visiting.has(tx.txid)) throw Error('Cyclic transaction graph');
        visiting.add(tx.txid);
        for (const input of tx.vin) {
          const parent = transactions.get(input.txid);
          if (parent) { if (parent.height > tx.height) throw Error('Parent confirmed after child'); visit(parent); }
        }
        visiting.delete(tx.txid); done.add(tx.txid); ordered.push(tx);
      };
      for (const tx of [...transactions.values()].sort((a,b) => a.height-b.height)) visit(tx);
      const blocks: Block[] = [];
      for (const tx of ordered) {
        let block = blocks.at(-1);
        if (!block || block.height !== tx.height) {
          const h = await p.header(tx.height);
          block = { height: h.height, hash: h.hash, parent: h.parent, mtp: 0, transactions: [] }; blocks.push(block);
        }
        if (tx.blockhash !== block.hash) throw Error('Chain changed during transaction discovery');
        block.transactions.push(tx);
      }
      return blocks;
    };
    let candidate = await build(), vaults = await this.project(candidate, read);
    for (const vault of vaults) for (const allocation of vault.allocations) await readHistory(allocation.output.scriptPubKey.hex);
    candidate = await build(); vaults = await this.project(candidate, read);
    // All spends must be present, and no confirmed output can have two spenders.
    const spends = new Map<string, string>();
    for (const tx of transactions.values()) for (const input of tx.vin) {
      const id = `${input.txid}:${input.vout}`;
      if (spends.has(id) && spends.get(id) !== tx.txid) throw Error('Conflicting confirmed spends');
      spends.set(id, tx.txid);
    }
    for (const vault of vaults) {
      for (const n of [0,1]) if (spends.has(`${vault.transaction.txid}:${n}`)) throw Error('Canonical lineage incomplete');
      for (const output of [vault.transaction.vout[0], vault.transaction.vout[1], ...vault.allocations.filter(a => !a.withdrawal).map(a => a.output)]) {
        const rows = await p.getUtxosForLockingBytecode(output.scriptPubKey.hex);
        const txid = output === vault.transaction.vout[0] || output === vault.transaction.vout[1] ? vault.transaction.txid : vault.allocations.find(a => a.output === output)!.id.split(':')[0];
        if (!rows.some(u => u.txid === txid && u.vout === output.n)) {
          let pendingSpend = false;
          for (const id of unconfirmed) {
            const tx = await p.transaction(id);
            if (tx.vin.some((input: any) => input.txid === txid && input.vout === output.n)) pendingSpend = true;
          }
          if (!pendingSpend) throw Error('Canonical UTXO unavailable; confirmed snapshot withheld');
        }
      }
    }
    // Recheck all queried histories and headers to reject mixed snapshots and mid-pass reorganizations.
    for (const [script, history] of histories) if (json(await p.history(script)) !== json(history)) throw Error('History changed during indexing');
    for (const block of candidate) if ((await p.header(block.height)).hash !== block.hash) throw Error('Chain changed during indexing');
    await p.verifyHeaderChain(candidate[0]?.height ?? tip.height, tip, new Map(candidate.map(b => [b.height, b.hash])));
    const mtp = await p.medianTime(tip.height, tip.hash);
    if ((await p.tip()).hash !== tip.hash) throw Error('Tip changed during indexing');
    if (candidate.at(-1)?.height === tip.height) candidate.at(-1)!.mtp = mtp;
    else candidate.push({ height: tip.height, hash: tip.hash, parent: tip.parent, mtp, transactions: [] });
    if (this.path) {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`, file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(json({ version: 2, network: networkConfig().network, configs: this.configs, blocks: candidate })); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.path);
      const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
    }
    this.blocks = candidate; this.vaults = vaults;
    this.health = { ...this.health, connected: true, stale: false, error: '', updatedAt: new Date().toISOString(), endpoint: p.endpoint, unconfirmed: [...unconfirmed] };
  }
  async verifyUtxos() {
    if (this.electrum) { await this.sync(); return; }
    for (const v of this.vaults) {
      for (const [n, expected] of [utxo(v.transaction, 0), utxo(v.transaction, 1)].entries()) {
        const actual = await rpc('gettxout', [expected.txid, n, false]);
        if (!actual || Math.round(actual.value * 1e8) !== Number(expected.satoshis) || actual.scriptPubKey.hex !== expected.lockingBytecode
          || json(actual.tokenData ?? null) !== json(v.transaction.vout[n].tokenData ?? null)) throw Error('On-chain canonical UTXO mismatch');
      }
      for (const a of v.allocations) {
        const [txid, n] = a.id.split(':'); const actual = await rpc('gettxout', [txid, Number(n), false]);
        if (a.withdrawal ? actual !== null : !actual || actual.scriptPubKey.hex !== a.output.scriptPubKey.hex
          || Math.round(actual.value * 1e8) !== Math.round(a.output.value * 1e8) || json(actual.tokenData) !== json(a.output.tokenData)) throw Error('On-chain allocation mismatch');
      }
    }
  }
}
