import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertNetwork, networkConfig, rpc } from './rpc.js';
import { ElectrumProvider } from './electrum.js';
import { ElectrumIndexer, projectVaults, type CheckpointStore, type Checkpoint } from './indexer-core.js';
export type { Allocation, VaultState, Block } from './indexer-core.js';
import type { Block } from './indexer-core.js';
import { type VaultConfig, utxo, json, provider } from './arena.js';

/** One writer per checkpoint; independent keepers use separate checkpoint paths. */
export class Indexer extends ElectrumIndexer {
  constructor(configs: VaultConfig[], readonly path?: string, electrum?: ElectrumProvider) {
    super(configs, electrum, path ? new FileCheckpoints(path) : undefined);
    if (electrum && networkConfig().network !== 'chipnet') throw Error('Electrum indexer is chipnet-only');
    if (!electrum) this.health.provider = 'bchn';
  }
  override async load() {
    if (this.electrum) return super.load();
    if (!this.path) return;
    try {
      const saved: Checkpoint = JSON.parse(await readFile(this.path, 'utf8'));
      if ((saved.network ?? 'regtest') !== networkConfig().network) throw Error('Checkpoint network mismatch');
      if (saved.version !== (this.electrum ? 2 : 1) || json(saved.configs) !== json(this.configs)) throw Error('Checkpoint configuration mismatch');
      this.blocks = saved.blocks;
      // Rebuild only after active-chain reconciliation in sync().
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  private async project(blocks: Block[]) {
    return projectVaults(this.configs, blocks, id => rpc('getrawtransaction', [id, true]), provider);
  }
  override async sync() {
    if (this.electrum) return super.sync();
    if (this.busy) throw Error('Index sync already running');
    this.busy = true;
    this.health.syncing = true;
    try {
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
      await this.store?.save({ version: 1, network: networkConfig().network, configs: this.configs, blocks: candidate });
      this.blocks = candidate; this.vaults = vaults;
      this.health = { ...this.health, connected: true, stale: false, phase:'Synchronized', error: '', updatedAt: new Date().toISOString() };
    } catch (e) {
      this.health = { ...this.health, connected: false, stale: true, phase:'Disconnected', error: String(e) }; throw e;
    } finally { this.busy = false; this.health.syncing = false; }
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

/** Node checkpoints keep the same durable, atomic rename/fsync behavior. */
class FileCheckpoints implements CheckpointStore {
  constructor(readonly path: string) {}
  async load(): Promise<Checkpoint | undefined> {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  }
  async save(value: Checkpoint) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`, file = await open(temporary, 'w', 0o600);
    try { await file.writeFile(json(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, this.path);
    const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
}
