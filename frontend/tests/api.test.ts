import { expect, it } from 'vitest';
import { apiBaseUrl } from '../src/api';
import { loadSnapshot, saveSnapshot, snapshotKey } from '../src/snapshot';
import { fixture } from './fixture';

it('defaults to the proxy only in development and supports independent API prefixes', () => {
  expect(apiBaseUrl(undefined, true)).toBe('/api');
  expect(apiBaseUrl(undefined, false)).toBeNull();
  expect(apiBaseUrl('', true)).toBeNull();
  expect(apiBaseUrl('https://indexer.example.com/read-only/', false)).toBe('https://indexer.example.com/read-only');
  expect(apiBaseUrl('/api/', false)).toBe('/api');
  for (const url of ['//example.com', 'file:///tmp/api', 'https://user:secret@example.com', 'https://example.com?key=secret']) {
    expect(() => apiBaseUrl(url, false)).toThrow();
  }
});

it('persists only fresh confirmed snapshots and isolates them by endpoint', () => {
  const data = fixture(), now = Date.now();
  saveSnapshot('/one/vaults', data, now);
  expect(loadSnapshot('/one/vaults')).toEqual({ data, receivedAt: now });
  expect(loadSnapshot('/two/vaults')).toBeUndefined();
  for (const bad of [
    { ...data, confirmedOnly: false },
    { ...data, tip: null },
    { ...data, health: { ...data.health, connected: false } },
    { ...data, health: { ...data.health, updatedAt: new Date(now - 60000).toISOString() } },
  ]) {
    localStorage.setItem(snapshotKey('/invalid'), JSON.stringify({ data: bad, receivedAt: now }));
    expect(loadSnapshot('/invalid')).toBeUndefined();
  }
  data.health.connected = false;
  saveSnapshot('/one/vaults', data, now);
  expect(loadSnapshot('/one/vaults')?.data.health.connected).toBe(true);
  localStorage.setItem(snapshotKey('/broken'), 'broken');
  expect(loadSnapshot('/broken')).toBeUndefined();
});
