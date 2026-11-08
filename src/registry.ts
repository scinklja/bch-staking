import { createHash } from 'node:crypto';
export const RECORD_SIZE = 49;
export const LIVE = 6;
export const SNAPSHOT = LIVE + 16 * RECORD_SIZE;
export const STATE_SIZE = SNAPSHOT + 16 * RECORD_SIZE;
export function hashState(state: Uint8Array): string {
  return createHash('sha256').update(createHash('sha256').update(state).digest()).digest('hex');
}
export function uint(value: number, size: number) {
  const b = Buffer.alloc(size); b.writeUIntLE(value, 0, size); return b;
}
export function offer(pubkey: Uint8Array, stake: number, duration: number, reward: number, maxWins: number) {
  return Buffer.concat([pubkey, uint(stake, 4), uint(duration, 4), uint(reward, 4), uint(maxWins, 1), Buffer.alloc(3)]);
}
export interface PeriodSchedule { epoch: number; periodSeconds: number }
/** UTC arithmetic only; finality still depends on chain median time past. */
export function periodBoundary(schedule: PeriodSchedule, period: number): number {
  const boundary = schedule.epoch + period * schedule.periodSeconds;
  if (!Number.isInteger(schedule.epoch) || schedule.epoch < 500000000
      || !Number.isInteger(schedule.periodSeconds) || schedule.periodSeconds <= 0
      || !Number.isInteger(period) || period < 0 || !Number.isSafeInteger(boundary) || boundary > 2147483647) {
    throw new RangeError('Invalid UTC period boundary');
  }
  return boundary;
}
/** Witness construction only. Contract independently authenticates and derives every update. */
export function nextState(state: Uint8Array, action: number, slot = 0, record = new Uint8Array()) {
  const next = Buffer.from(state);
  if (action === 0) { next[5] = next[5]! + 1; next.set(record, LIVE + slot * RECORD_SIZE); }
  if (action === 1) next[LIVE + slot * RECORD_SIZE + 47] = 1;
  if (action === 2) { next[4] = 1; next.set(next.subarray(LIVE, SNAPSHOT), SNAPSHOT); }
  if (action === 3) {
    next.writeUInt32LE(next.readUInt32LE(0) + 1); next[4] = 0; next[LIVE + slot * RECORD_SIZE + 46]!++;
  }
  if (action === 5) { next.writeUInt32LE(next.readUInt32LE(0) + 1); next[4] = 0; }
  if (action === 4) next[LIVE + slot * RECORD_SIZE + 48] = 1;
  return next;
}

/** All allocation metadata is script-bound and independently derived by Registry. */
export function allocationTerms(owner: Uint8Array, vaultCategory: string, assetCategory: string,
  slot: number, period: number, stake: number, maturity: number): Buffer {
  if (owner.length !== 33 || !/^[0-9a-f]{64}$/i.test(vaultCategory) || !/^[0-9a-f]{64}$/i.test(assetCategory)) {
    throw new Error('Invalid allocation identity');
  }
  return Buffer.concat([owner, Buffer.from(vaultCategory, 'hex').reverse(), uint(slot, 1), uint(period, 4),
    uint(stake, 4), uint(maturity, 4), Buffer.from(assetCategory, 'hex').reverse()]);
}
export function remainingCommitment(state: Uint8Array): bigint {
  const b = Buffer.from(state); let total = 0n;
  for (let i = 0; i < b[5]!; i++) {
    const o = LIVE + i * RECORD_SIZE;
    if (!b[o + 48]) total += BigInt(b.readUInt32LE(o + 33)) * BigInt(b[o + 45]! - b[o + 46]!);
  }
  return total;
}
