import { useCallback, useEffect, useRef, useState } from 'react';
import { envelopeSchema, type Envelope } from './model';
export const REFRESH_MS = 10000;
export function useArena() {
  const [data,setData] = useState<Envelope>();
  const [error,setError] = useState<string|null>(null);
  const [pending,setPending] = useState(true);
  const [receivedAt,setReceivedAt] = useState<number>();
  const [now,setNow] = useState(Date.now());
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController;
    async function refresh() {
      if (stopped || busy) return;
      busy = true; clearTimeout(timer); setPending(true); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/vaults', { cache:'no-store', signal:controller.signal });
        if (!response.ok) throw Error(`Indexer returned HTTP ${response.status}.`);
        const parsed = envelopeSchema.safeParse(await response.json());
        if (!parsed.success) throw Error('The indexer response is incompatible or malformed. Expected the confirmed-only v0.3.0 regtest API.');
        if (!stopped) { setData(parsed.data); setReceivedAt(Date.now()); setError(null); }
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
  },[]);
  return { data, error, pending, receivedAt, now, refresh:useCallback(() => request.current(),[]) };
}
