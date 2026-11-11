import { useCallback, useEffect, useRef, useState } from 'react';
import { envelopeSchema, type Envelope } from './model';
import { browserConfig, indexerSource } from './browserConfig';
import { apiBaseUrl } from './api';
import { loadSnapshot, saveSnapshot } from './snapshot';
export const REFRESH_MS = 10000;
export function useArena() {
  const [config] = useState(() => {
    try { const base = apiBaseUrl(); return { base, source:indexerSource(base), error: null }; }
    catch (e) { return { base: null, source:'off' as const, error: (e as Error).message }; }
  });
  const endpoint = config.source === 'api' && config.base ? `${config.base}/vaults` : null;
  const [saved] = useState(() => endpoint ? loadSnapshot(endpoint) : undefined);
  const [data,setData] = useState<Envelope | undefined>(saved?.data);
  const [fromSnapshot,setFromSnapshot] = useState(!!saved);
  const [providerStatus,setProviderStatus] = useState('Connecting');
  const [error,setError] = useState<string|null>(null);
  const [pending,setPending] = useState(!!endpoint || config.source === 'electrum');
  const [receivedAt,setReceivedAt] = useState<number | undefined>(saved?.receivedAt);
  const [now,setNow] = useState(Date.now());
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    if (config.source === 'electrum') {
      let worker: Worker | undefined, startup: ReturnType<typeof setTimeout> | undefined;
      const clock=setInterval(()=>setNow(Date.now()),1000);
      try {
        const settings=browserConfig();
        worker = new Worker(new URL('./arena.worker.ts',import.meta.url),{type:'module'});
        startup=setTimeout(()=>{setError('Browser indexer worker did not become ready. Reload or use API mode.');setProviderStatus('Worker unavailable');setPending(false);},30000);
        worker.onmessage = event => {
          if(event.data?.type==='ready') {clearTimeout(startup);worker?.postMessage({type:'start',config:settings});return;}
          if(event.data?.type==='error') { setError(event.data.error);setPending(false);return; }
          if(event.data?.type!=='snapshot')return;
          const parsed=envelopeSchema.safeParse(event.data.envelope);
          if(!parsed.success || parsed.data.chain!=='chipnet') {setError('Browser indexer returned an incompatible response');setPending(false);return;}
          const h=parsed.data.health;
          setProviderStatus(`${h.phase||'Connecting'}${event.data.role==='follower'?' · following another tab':''}${parsed.data.tip?` · indexed height ${parsed.data.tip.height}`:''}${h.transactions?` · ${h.transactions} transactions checked`:''}${h.endpoint?` · ${new URL(h.endpoint).host}`:''}`);
          if(parsed.data.tip) {setData({...parsed.data,health:{...h,role:event.data.role}});setFromSnapshot(!!event.data.cached);}
          setPending(!!h.syncing || (!parsed.data.tip && !h.error));
          setError(parsed.data.health.error || null);
          if(parsed.data.health.updatedAt)setReceivedAt(Date.parse(parsed.data.health.updatedAt));
        };
        worker.onerror=event=>{clearTimeout(startup);setError(`Browser indexer worker failed: ${event.message}`);setPending(false);};
        request.current=()=>worker?.postMessage({type:'refresh'});
      } catch(error) {setError(String(error));setPending(false);}
      const reconnect=()=>{if(document.visibilityState==='visible')request.current();};
      document.addEventListener('visibilitychange',reconnect);window.addEventListener('online',reconnect);
      return ()=>{worker?.terminate();clearTimeout(startup);clearInterval(clock);request.current=()=>{};document.removeEventListener('visibilitychange',reconnect);window.removeEventListener('online',reconnect);};
    }
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
        if (!parsed.success) throw Error('The indexer response is incompatible or malformed. Expected the confirmed-only v0.3.0 chipnet/regtest API.');
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
  },[endpoint, config.error, config.source]);
  return { data, error, pending, receivedAt, now, fromSnapshot, configured: !!endpoint || config.source === 'electrum', source:config.source, providerStatus, refresh:useCallback(() => request.current(),[]) };
}
