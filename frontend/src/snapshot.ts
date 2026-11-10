import { envelopeSchema, staleReason, type Envelope } from './model';

export const snapshotKey = (endpoint: string) => `staking-arena:confirmed:v1:${endpoint}`;
export type Snapshot = { data: Envelope; receivedAt: number };

// Browser-local convenience only: the indexer supplies confirmation metadata.
// This cache is never evidence of current canonical chain state.
export function loadSnapshot(endpoint: string): Snapshot | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(snapshotKey(endpoint)) ?? 'null');
    if (!saved || !Number.isSafeInteger(saved.receivedAt) || saved.receivedAt < 0 || saved.receivedAt > Date.now()) return;
    const data = envelopeSchema.parse(saved.data);
    if (!data.health.connected || !data.tip || staleReason(data, saved.receivedAt, null)) return;
    return { data, receivedAt: saved.receivedAt };
  } catch { /* Storage can be unavailable, corrupt or from an older schema. */ }
}

export function saveSnapshot(endpoint: string, data: Envelope, receivedAt: number) {
  if (staleReason(data, receivedAt, null)) return;
  try { localStorage.setItem(snapshotKey(endpoint), JSON.stringify({ data, receivedAt })); }
  catch { /* A storage quota or privacy setting must not break the live viewer. */ }
}
