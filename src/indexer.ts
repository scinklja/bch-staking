import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertRegtest, rpc } from './rpc.js';
import { verifyRegistryGenesis } from './genesis.js';
import { type VaultConfig, contracts, contract, utxo, transitionWitness, termsFor, json } from './arena.js';
import { hashState, nextState, remainingCommitment, STATE_SIZE } from './registry.js';

export interface Allocation { id: string; terms: string; output: any; withdrawal?: string }
export interface VaultState { config: VaultConfig; category: string; witness: string; transaction: any; history: { txid: string; height: number; action: number; slot: number; period: number; witness: string }[]; allocations: Allocation[] }
interface Block { height: number; hash: string; parent?: string; mtp: number; transactions: any[] }
interface Checkpoint { version: number; configs: VaultConfig[]; blocks: Block[] }
/** One writer per checkpoint; independent keepers use separate checkpoint paths. */
export class Indexer {
  blocks: Block[] = [];
  vaults: VaultState[] = [];
  health = { connected: false, error: '', updatedAt: '' };
  private busy = false;
  constructor(readonly configs: VaultConfig[], readonly path?: string) {}
  get tip() { return this.blocks.at(-1); }
  async load() {
    if (!this.path) return;
    try {
      const saved: Checkpoint = JSON.parse(await readFile(this.path, 'utf8'));
      if (saved.version !== 1 || json(saved.configs) !== json(this.configs)) throw Error('Checkpoint configuration mismatch');
      this.blocks = saved.blocks;
      // Rebuild only after active-chain reconciliation in sync().
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  private async project(blocks: Block[]) {
    const vaults: VaultState[] = [];
    const admitted = new Map<string, Awaited<ReturnType<typeof contracts>>>();
    for (const block of blocks) for (const tx of block.transactions) {
      for (const config of this.configs.filter(c => c.genesis === tx.txid)) {
        const verified = await verifyRegistryGenesis(config.genesis, config);
        const cs = await contracts(config, verified.category);
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
          const allocation = await contract('StakeAllocation', [terms]);
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
    try {
      await assertRegtest();
      const info = await rpc('getblockchaininfo');
      const candidate = this.blocks.slice();
      while (candidate.length && (candidate.at(-1)!.height > info.blocks || await rpc('getblockhash', [candidate.at(-1)!.height]) !== candidate.at(-1)!.hash)) candidate.pop();
      // Retain relevant transactions only, but every block hash for arbitrary-depth rollback.
      const tracked = new Set(this.configs.map(c => c.genesis));
      for (const block of candidate) for (const tx of block.transactions) tracked.add(tx.txid);
      let firstHeight = candidate.at(-1) ? candidate.at(-1)!.height + 1 : 0;
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
        try { await file.writeFile(json({ version: 1, configs: this.configs, blocks: candidate })); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.path);
        const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      }
      this.blocks = candidate; this.vaults = vaults;
      this.health = { connected: true, error: '', updatedAt: new Date().toISOString() };
    } catch (e) {
      this.health = { ...this.health, connected: false, error: String(e) }; throw e;
    } finally { this.busy = false; }
  }
  async verifyUtxos() {
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
