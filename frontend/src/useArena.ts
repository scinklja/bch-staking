import { useCallback, useEffect, useRef, useState } from 'react';
import { envelopeSchema, type Envelope } from './model';
import { apiBaseUrl } from './api';
import { loadSnapshot, saveSnapshot } from './snapshot';
export const REFRESH_MS = 10000;
export function useArena() {
  const [config] = useState(() => {
    try { return { base: apiBaseUrl(), error: null }; }
    catch (e) { return { base: null, error: (e as Error).message }; }
  });
  const endpoint = config.base ? `${config.base}/vaults` : null;
  const [saved] = useState(() => endpoint ? loadSnapshot(endpoint) : undefined);
  const [data,setData] = useState<Envelope | undefined>(saved?.data);
  const [fromSnapshot,setFromSnapshot] = useState(!!saved);
  const [error,setError] = useState<string|null>(null);
  const [pending,setPending] = useState(!!endpoint);
  const [receivedAt,setReceivedAt] = useState<number | undefined>(saved?.receivedAt);
  const [now,setNow] = useState(Date.now());
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    if (!endpoint) {
      setError(config.error ?? 'No API is configured for this static website.');
      return;
    }
    const url = endpoint;
    let stopped = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController;
    async function refresh() {
      if (stopped || busy) return;
      busy = true; clearTimeout(timer); setPending(true); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { cache:'no-store', credentials:'omit', signal:controller.signal });
        if (!response.ok) throw Error(`Indexer returned HTTP ${response.status}.`);
        const parsed = envelopeSchema.safeParse(await response.json());
        if (!parsed.success) throw Error('The indexer response is incompatible or malformed. Expected the confirmed-only v0.3.0 regtest API.');
        if (!stopped) {
          const received = Date.now();
          setData(parsed.data); setReceivedAt(received); setFromSnapshot(false); setError(null);
          saveSnapshot(url, parsed.data, received);
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Indexer request timed out.');
      } finally {
        clearTimeout(timeout); busy = false;
        if (!stopped) { setPending(false); timer = setTimeout(refresh,REFRESH_MS); }
      }
    }
    request.current = () => { void refresh(); };
    void refresh();
    const clock = setInterval(() => setNow(Date.now()),1000);
    const reconnect = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange',reconnect); window.addEventListener('online',reconnect);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); controller?.abort(); document.removeEventListener('visibilitychange',reconnect); window.removeEventListener('online',reconnect); };
  },[endpoint, config.error]);
  return { data, error, pending, receivedAt, now, fromSnapshot, configured: !!endpoint, refresh:useCallback(() => request.current(),[]) };
}
