import { createServer } from 'node:http';
import { Indexer } from './indexer.js';
import { json, rankings, records } from './arena.js';
import { periodBoundary, remainingCommitment } from './registry.js';

export function vaultView(index: Indexer, category: string) {
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
    bchSatoshis: Math.round(v.transaction.vout[0].value * 1e8).toString(), escrowTokens: remainingCommitment(state).toString(),
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
export function api(index: Indexer) {
  return createServer((req, res) => {
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    const send = (status: number, body: unknown) => { res.writeHead(status); res.end(json(body)); };
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); send(405, { error: 'Read-only API' }); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
    const meta = { chain: 'regtest', health: index.health, tip: index.tip ? { height: index.tip.height, hash: index.tip.hash, mtp: index.tip.mtp } : null, confirmedOnly: true };
    if (path.length === 1 && path[0] === 'health') { send(index.health.connected ? 200 : 503, meta); return; }
    if (path[0] !== 'vaults') { send(404, { error: 'Not found' }); return; }
    if (path.length === 1) { send(200, { ...meta, vaults: index.vaults.map(v => vaultView(index, v.category)) }); return; }
    const view = vaultView(index, path[1]!);
    if (!view) { send(404, { error: 'Vault not indexed' }); return; }
    const endpoints = ['offers', 'rankings', 'periods', 'allocations', 'withdrawals', 'history'] as const;
    const endpoint = endpoints.find(e => e === path[2]);
    if (path.length > 2 && (path.length !== 3 || !endpoint)) { send(404, { error: 'Not found' }); return; }
    send(200, { ...meta, data: endpoint ? view[endpoint] : view });
  });
}
