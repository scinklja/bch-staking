import { Buffer } from './bytes.js';
import type { ElectrumIndexer } from './indexer-core.js';
import { records, rankings } from './arena-core.js';
import { satoshis } from './amount.js';
import { periodBoundary, remainingCommitment } from './registry.js';
export type IndexView = Pick<ElectrumIndexer, 'vaults' | 'tip' | 'health'>;
export function vaultView(index: IndexView, category: string) {
  const v = index.vaults.find(v => v.category === category);
  if (!v) return;
  const state = Buffer.from(v.witness, 'hex'), period = state.readUInt32LE(0), mtp = index.tip?.mtp ?? 0;
  const offers = records(state), allocations = v.allocations.map(a => {
    const terms = Buffer.from(a.terms, 'hex');
    return { ...a, owner: terms.subarray(0,33).toString('hex'), slot: terms[65], period: terms.readUInt32LE(66),
      stake: terms.readUInt32LE(70), maturity: terms.readUInt32LE(74), eligible: !a.withdrawal && mtp > terms.readUInt32LE(74), requiresOwnerSignature: true };
  });
  return { category: v.category, config: v.config, period, phase: state[4] ? 'activated' : 'open',
    stateOutpoint: `${v.transaction.txid}:0`, poolOutpoint: `${v.transaction.txid}:1`, witness: v.witness,
    bchSatoshis: satoshis(v.transaction.vout[0]).toString(), escrowTokens: remainingCommitment(state).toString(),
    unsettledPeriods: Array.from({ length: v.config.periods - period }, (_, i) => i + period),
    readyPeriods: Array.from({ length: v.config.periods - period }, (_, i) => i + period).filter(p => mtp > periodBoundary(v.config, p)),
    offers, rankings: rankings(state), snapshot: state[4] ? records(state, true) : null,
    periods: Array.from({ length: v.config.periods }, (_, p) => ({ period: p, boundary: periodBoundary(v.config, p),
      status: p < period ? 'settled' : p === period && state[4] ? 'activated' : 'unsettled',
      events: v.history.filter(h => h.period === p && [2,3,5].includes(h.action)) })),
    allocations, withdrawals: { allocations, commitments: offers.map(o => ({ slot: o.slot,
      eligible: !state[4] && o.cancelled && !o.refunded && o.wins < o.maxWins,
      amount: (o.refunded ? 0n : BigInt(o.stake) * BigInt(o.maxWins - o.wins)).toString(), requiresOwnerSignature: true })),
      history: v.history.filter(h => h.action === 4) }, history: v.history };
}
export function indexEnvelope(index: IndexView) {
  return { chain: 'chipnet' as const, confirmedOnly: true as const,
    tip: index.tip ? {height:index.tip.height, hash:index.tip.hash, mtp:index.tip.mtp} : null,
    health: { ...index.health, stale: index.health.stale || !index.health.updatedAt || Date.now()-Date.parse(index.health.updatedAt)>60000 },
    vaults: index.vaults.map(v => vaultView(index, v.category)!) };
}
