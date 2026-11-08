import { createHash } from 'node:crypto';
export const RECORD_SIZE = 53;
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
  return Buffer.concat([pubkey, uint(stake, 4), uint(duration, 4), uint(reward, 4), uint(maxWins, 1), Buffer.alloc(7)]);
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
export function nextState(state: Uint8Array, action: number, slot = 0, record = new Uint8Array(), schedule?: PeriodSchedule) {
  const next = Buffer.from(state);
  if (action === 0) { next[5] = next[5]! + 1; next.set(record, LIVE + slot * RECORD_SIZE); }
  if (action === 1) next[LIVE + slot * RECORD_SIZE + 47] = 1;
  if (action === 2) { next[4] = 1; next.set(next.subarray(LIVE, SNAPSHOT), SNAPSHOT); }
  if (action === 3) {
    if (!schedule) throw new Error('Settlement requires the immutable UTC schedule');
    const offset = LIVE + slot * RECORD_SIZE;
    const duration = next.readUInt32LE(SNAPSHOT + slot * RECORD_SIZE + 37);
    const maturity = periodBoundary(schedule, next.readUInt32LE(0) + duration);
    next.writeUInt32LE(Math.max(next.readUInt32LE(offset + 49), maturity), offset + 49);
    next.writeUInt32LE(next.readUInt32LE(0) + 1); next[4] = 0; next[offset + 46]!++;
  }
  if (action === 5) { next.writeUInt32LE(next.readUInt32LE(0) + 1); next[4] = 0; }
  if (action === 4) next[LIVE + slot * RECORD_SIZE + 48] = 1;
  return next;
}
