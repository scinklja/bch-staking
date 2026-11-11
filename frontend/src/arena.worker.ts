/// <reference lib="webworker" />
import { BrowserElectrumProvider } from '../../src/electrum-wss';
import { ElectrumIndexer } from '../../src/indexer-core';
import { IndexedDbCheckpoints } from '../../src/indexeddb';
import { sha256Bytes, Buffer } from '../../src/bytes';
import { indexEnvelope } from '../../src/view';
import type { BrowserIndexerConfig } from './browserConfig';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let channel: BroadcastChannel | undefined, refresh: (()=>void) | undefined, started=false;
scope.onmessage = event => {
  if (event.data?.type === 'refresh') { if (refresh) refresh(); else channel?.postMessage({type:'refresh'}); return; }
  if (event.data?.type === 'start' && !started) {
    started=true;
    void start(event.data.config).catch(error=>scope.postMessage({type:'error',error:String(error)}));
  }
};
// libauth initializes WASM with top-level await. Handshake after handlers exist so the initial message cannot be lost.
scope.postMessage({type:'ready'});
async function start(config: BrowserIndexerConfig) {
  if (config.network !== 'chipnet') throw Error('Browser indexing is chipnet-only');
  const {tabId,...identity}=config;
  const fingerprint=sha256Bytes(Buffer.from(JSON.stringify({version:3,...identity}))).toString('hex');
  const lockName=`arena-electrum-${fingerprint}`, locks=scope.navigator.locks;
  const store = new IndexedDbCheckpoints(locks ? fingerprint : `${fingerprint}:${tabId}`);
  const provider = new BrowserElectrumProvider(config), index = new ElectrumIndexer(config.vaults,provider,store);
  let verified=false, cached: ReturnType<typeof indexEnvelope> | undefined, leader=false;
  const publish = () => {
    const envelope=indexEnvelope(index);
    const value = !verified && cached ? {...cached,health:envelope.health} : envelope;
    const packet={type:'snapshot',envelope:value,cached:!verified,role:leader?'leader':'waiting'};
    scope.postMessage(packet);
    if(leader)channel?.postMessage(packet);
  };
  try {
    await index.load();
    index.health.updatedAt=store.cached?.updatedAt ?? '';
    if(store.cached?.vaults && index.blocks.length) cached=indexEnvelope({...index,vaults:store.cached.vaults,tip:index.tip});
  } catch(error) { index.blocks=[]; index.health.error=`Saved checkpoint unavailable; rebuilding. ${String(error)}`; }
  if (locks && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(lockName);
    channel.onmessage = event => {
      if(event.data?.type==='snapshot' && !leader) scope.postMessage({...event.data,role:'follower'});
      if(event.data?.type==='refresh' && leader) refresh?.();
    };
    channel.postMessage({type:'refresh'});
  }
  index.health.phase = locks ? 'Waiting for the indexing tab' : 'Connecting (independent tab)'; publish();
  const run = async () => {
    leader=true; index.health.phase='Connecting';
    let busy=false, failures=0, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if(busy)return;
      busy=true;clearTimeout(timer);publish();
      try { await index.sync(); verified=true;failures=0; }
      catch { failures++; /* The shared indexer retains the last successful state and sets stale/error. */ }
      finally { busy=false; publish(); timer=setTimeout(()=>{void poll();},Math.min(60000,config.pollMs*(2**Math.min(failures,3)))); }
    };
    index.onChange=publish; refresh=()=>{void poll();}; await poll();
    // The browser releases this lock, WSS sockets and worker resources when the owning tab closes.
    await new Promise<void>(()=>{});
  };
  if(locks) await locks.request(lockName,{mode:'exclusive'},run);
  else await run();
}
