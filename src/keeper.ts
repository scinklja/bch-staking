import { recordChipnetBroadcast } from './chain-evidence.js';
import { rpc, assertNetwork } from './rpc.js';
import { Indexer, type VaultState } from './indexer.js';
import { utxo, provider } from './arena.js';

export type { Sponsor, Sponsorship } from './keeper-core.js';
import { buildKeeperTransition, type Sponsorship } from './keeper-core.js';
export class Keeper {
  constructor(readonly index: Indexer, readonly sponsor?: Sponsorship) {}
  async build(vault: VaultState) {
    await assertNetwork();
    const info=await rpc('getblockchaininfo');
    return buildKeeperTransition(vault,provider,{height:info.blocks,mtp:info.mediantime},this.sponsor);
  }
  /** A confirmed-state step per vault. Competing spends are left to BCHN; no local state is mutated optimistically. */
  async tick() {
    await this.index.sync();
    const results: { category: string; status: string; txid?: string; error?: string }[] = [];
    for (const v of this.index.vaults) {
      try {
        const current = utxo(v.transaction, 0);
        if (!await rpc('gettxout', [current.txid, current.vout, true])) { results.push({ category: v.category, status: 'pending-or-competing-spend' }); continue; }
        const candidate = await this.build(v);
        if (!candidate) { results.push({ category: v.category, status: 'waiting-or-complete' }); continue; }
        const [accept] = await rpc('testmempoolaccept', [[candidate.raw]]);
        if (!accept.allowed) { results.push({ category: v.category, status: 'rejected', error: accept['reject-reason'] }); continue; }
        const txid = await rpc<string>('sendrawtransaction', [candidate.raw]);
        await recordChipnetBroadcast(`keeper-action-${candidate.action}`,txid);
        results.push({ category: v.category, status: 'broadcast', txid });
      } catch (e) { results.push({ category: v.category, status: 'retry', error: String(e) }); }
    }
    return results;
  }
}
