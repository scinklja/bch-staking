import { recordChipnetBroadcast } from './chain-evidence.js';
import { TransactionBuilder, type SpendableUtxo, type Unlocker } from 'cashscript';
import { encodeCashAddress, hash160 } from '@bitauth/libauth';
import { rpc, assertNetwork, networkConfig } from './rpc.js';
import { Indexer, type VaultState } from './indexer.js';
import { contracts, contract, rankings, termsFor, utxo, provider } from './arena.js';
import { hashState, nextState, remainingCommitment, periodBoundary } from './registry.js';

export interface Sponsor { input: SpendableUtxo; unlocker: Unlocker }
export type Sponsorship = (vault: VaultState, action: number) => Promise<Sponsor | undefined>;
export class Keeper {
  constructor(readonly index: Indexer, readonly sponsor?: Sponsorship) {}
  async build(vault: VaultState) {
    await assertNetwork();
    const state = Buffer.from(vault.witness, 'hex'), period = state.readUInt32LE(0);
    if (period >= vault.config.periods) return;
    const mtp = (await rpc('getblockchaininfo')).mediantime;
    if (!state[4] && mtp <= periodBoundary(vault.config, period)) return;
    const ranked = rankings(state, true);
    const action = !state[4] ? 2 : ranked.length ? 3 : 5, slot = action === 3 ? ranked[0]!.slot : 0;
    const sponsor = await this.sponsor?.(vault, action);
    if (sponsor?.input.token) throw Error('Fee sponsorship must be BCH-only');
    const cs = await contracts(vault.config, vault.category), next = nextState(state, action, slot);
    const reward = action === 3 ? BigInt(ranked[0]!.reward) : 0n;
    const amount = utxo(vault.transaction, 0).satoshis - reward - (sponsor ? 0n : action === 3 ? 12000n : 10000n);
    if (amount < BigInt((vault.config.periods - next.readUInt32LE(0)) * vault.config.cap + 1000)) throw Error('Fee sponsorship required to preserve reward reserve');
    const builder = new TransactionBuilder({ provider }).setLocktime(action === 2 ? periodBoundary(vault.config, period) : mtp - 1)
      .addInput(utxo(vault.transaction, 0), cs.registry.unlock.transition(state, BigInt(action), BigInt(slot), Buffer.alloc(0), Buffer.alloc(0)))
      .addInput(utxo(vault.transaction, 1), cs.pool.unlock.spend());
    if (sponsor) builder.addInput(sponsor.input, sponsor.unlocker);
    builder.addOutput({ to: cs.registry.tokenAddress, amount, token: { category: vault.category, amount: 0n, nft: { capability: 'mutable', commitment: hashState(next) } } });
    const remaining = remainingCommitment(next);
    builder.addOutput({ to: cs.pool.tokenAddress, amount: 1000n, ...(remaining ? { token: { category: vault.config.stakingCategory, amount: remaining } } : {}) });
    if (action === 3) {
      const winner = ranked[0]!;
      const address = encodeCashAddress({ prefix: networkConfig().prefix, type: 'p2pkh', payload: hash160(Buffer.from(winner.owner, 'hex')) });
      if (typeof address === 'string') throw Error(address);
      builder.addOutput({ to: address.address, amount: reward });
      const allocation = await contract('StakeAllocation', [termsFor(vault.config, vault.category, state, slot)]);
      builder.addOutput({ to: allocation.tokenAddress, amount: 2000n, token: { category: vault.config.stakingCategory, amount: BigInt(winner.stake) } });
    }
    return { raw: builder.build(), action, slot, period };
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
