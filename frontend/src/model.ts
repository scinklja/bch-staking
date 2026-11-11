import { z } from 'zod';
const hex = z.string().regex(/^[a-f0-9]{64}$/i);
const natural = z.number().int().nonnegative();
const units = z.string().regex(/^\d+$/);
const timestamp = natural.max(2147483647);
const stateWitness = z.string().regex(/^[a-f0-9]{3148}$/i).refine(value => parseInt(value.slice(8,10),16) <= 1 && parseInt(value.slice(10,12),16) <= 16, 'Invalid state phase or roster count');
export const offerSchema = z.object({ slot: natural.max(15), owner: z.string().regex(/^[a-f0-9]{66}$/i), stake: natural.positive(), duration: natural.positive(), reward: natural.positive(), maxWins: natural.positive(), wins: natural, cancelled: z.boolean(), refunded: z.boolean() });
const eventSchema = z.object({ txid: hex, height: natural, action: natural.max(5), slot: natural.max(15), period: natural, witness: stateWitness });
export const vaultSchema = z.object({
  category: hex, config: z.object({ genesis: hex, stakingCategory: hex, epoch: timestamp, periodSeconds: natural.positive(), periods: natural.positive().max(16), cap: natural.positive() }),
  period: natural.max(16), phase: z.enum(['open','activated']), bchSatoshis: units, escrowTokens: units,
  stateOutpoint: z.string(), poolOutpoint: z.string(), witness: stateWitness,
  unsettledPeriods: z.array(natural), readyPeriods: z.array(natural),
  offers: z.array(offerSchema).max(16), rankings: z.array(offerSchema).max(16), snapshot: z.array(offerSchema).nullable(),
  periods: z.array(z.object({ period: natural, boundary: timestamp, status: z.enum(['settled','activated','unsettled']), events: z.array(eventSchema) })),
  history: z.array(eventSchema),
  allocations: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}:\d+$/i), terms: z.string().regex(/^[a-f0-9]{220}$/i), owner: z.string(), slot: natural, period: natural, stake: natural, maturity: timestamp, eligible: z.boolean(), requiresOwnerSignature: z.boolean(), withdrawal: hex.optional() })),
  withdrawals: z.object({ commitments: z.array(z.object({ slot: natural, amount: units, eligible: z.boolean(), requiresOwnerSignature: z.boolean() })) }),
});
export const envelopeSchema = z.object({ chain: z.enum(['chipnet', 'regtest']), confirmedOnly: z.literal(true), tip: z.object({ height: natural, hash: hex, mtp: timestamp }).nullable(), health: z.object({ connected: z.boolean(), error: z.string(), updatedAt: z.string(), stale:z.boolean().optional(), syncing:z.boolean().optional(), endpoint:z.string().optional(), phase:z.string().optional(), transactions:natural.optional(), unconfirmed:z.array(hex).optional(), role:z.enum(['leader','follower','waiting']).optional() }), vaults: z.array(vaultSchema) });
export type Offer = z.infer<typeof offerSchema>;
export type Vault = z.infer<typeof vaultSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type ChainEvent = Vault['history'][number];
export const short = (value: string, size = 6) => value.length > size * 2 + 1 ? `${value.slice(0,size)}…${value.slice(-size)}` : value;
export function bch(sats: string | bigint | number) {
  const value = BigInt(sats), sign = value < 0n ? '-' : '', absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100000000n}.${(absolute % 100000000n).toString().padStart(8,'0')}`;
}
export const tokenUnits = (amount: string | number | bigint) => BigInt(amount).toLocaleString('en-US');
export function utc(seconds: number) {
  return new Date(seconds * 1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
}
export function score(o: Offer) {
  // P uses R in satoshis, exactly as the covenant does. Display truncates to six decimals.
  const numerator = BigInt(o.stake) * BigInt(o.duration), denominator = BigInt(o.reward);
  const fraction = ((numerator % denominator) * 1000000n / denominator).toString().padStart(6,'0').replace(/0+$/,'');
  return `${numerator / denominator}${fraction ? '.' + fraction : ''}`;
}
export function ranked(offers: Offer[]) {
  return offers.filter(o => !o.cancelled && !o.refunded && o.wins < o.maxWins).sort((a,b) => {
    const left = BigInt(a.stake) * BigInt(a.duration) * BigInt(b.reward), right = BigInt(b.stake) * BigInt(b.duration) * BigInt(a.reward);
    return left === right ? a.slot-b.slot : left > right ? -1 : 1;
  });
}
export function offerStatus(o: Offer) {
  return o.refunded ? 'Refunded' : o.cancelled ? 'Cancelled' : o.wins >= o.maxWins ? 'Exhausted' : 'Eligible';
}
/** Snapshot can be reconstructed from the activation event's complete PRE-transition witness. */
export function activationSnapshot(event: ChainEvent): Offer[] {
  const bytes = Uint8Array.from(event.witness.match(/../g)!, hex => parseInt(hex,16));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes[5] }, (_, slot) => {
    const o = 6 + slot * 49;
    return { slot, owner: [...bytes.slice(o,o+33)].map(b => b.toString(16).padStart(2,'0')).join(''), stake: view.getUint32(o+33,true), duration: view.getUint32(o+37,true), reward: view.getUint32(o+41,true), maxWins: bytes[o+45], wins: bytes[o+46], cancelled: !!bytes[o+47], refunded: !!bytes[o+48] };
  });
}
export function staleReason(data: Envelope | undefined, now: number, lastError: string | null) {
  if (lastError) return data ? 'Refresh failed. Showing the last successful response; eligibility and rankings may have changed.' : 'Unable to read the indexer. No confirmed vault data has been loaded.';
  if (!data) return null;
  if (!data.health.connected || data.health.stale) return 'Indexer is not synchronized. Values refer to the last successful indexed block.';
  const updated = Date.parse(data.health.updatedAt);
  if (!data.tip || !Number.isFinite(updated) || now - updated > 30000 || updated - now > 30000) return 'Indexer data is stale or its clock is out of sync. Check the indexer before relying on this view.';
  return null;
}
