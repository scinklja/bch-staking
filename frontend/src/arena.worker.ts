/// <reference lib="webworker" />
import { BrowserElectrumProvider } from '../../src/electrum-wss';
import { BrowserKeeper } from '../../src/browser-keeper';
import { IndexedDbSettlementStore } from '../../src/settlement-store';
import { ElectrumIndexer } from '../../src/indexer-core';
import { IndexedDbCheckpoints } from '../../src/indexeddb';
import { sha256Bytes, Buffer } from '../../src/bytes';
import { indexEnvelope } from '../../src/view';
import {workerDiagnostic} from './workerDiagnostics';
import type { BrowserIndexerConfig } from './browserConfig';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let channel: BroadcastChannel | undefined, controls:BroadcastChannel|undefined;
const requested=new Set<string>();
const control=(data:any)=>{
  if(data?.type==='process-period' && /^[a-f0-9]{64}$/i.test(data.category??''))requested.add(data.category);
};
let refresh: (()=>void) | undefined, started=false;
scope.onmessage = event => {
  if(event.data?.type==='process-period') {control(event.data);controls?.postMessage(event.data);refresh?.();return;}
  if (event.data?.type === 'refresh') { if (refresh) refresh(); else channel?.postMessage({type:'refresh'}); return; }
  if (event.data?.type === 'start' && !started) {
    started=true;
    void start(event.data.config).catch(error=>scope.postMessage({type:'error',fatal:true,diagnostic:workerDiagnostic(error,scope.location.href,'indexer start')}));
  }
};
// libauth initializes WASM with top-level await. Handshake after handlers exist so the initial message cannot be lost.
scope.postMessage({type:'ready'});
async function start(config: BrowserIndexerConfig) {
  if (config.network !== 'chipnet') throw Error('Browser indexing is chipnet-only');
  const {tabId,...identity}=config;
  const fingerprint=sha256Bytes(Buffer.from(JSON.stringify({version:5,...identity}))).toString('hex');
  const lockName=`arena-electrum-mandatory-v1-${fingerprint}`, locks=scope.navigator.locks;
  const store = new IndexedDbCheckpoints(locks ? fingerprint : `${fingerprint}:${tabId}`);
  const provider = new BrowserElectrumProvider({...config,allowBroadcast:true}), index = new ElectrumIndexer(config.vaults,provider,store,config.minDisplayConfirmations ?? 0);
  const keeper=new BrowserKeeper(index,new IndexedDbSettlementStore(),async(category,work)=>{
    if(!locks || typeof BroadcastChannel==='undefined')throw Error('Browser settlement requires Web Locks and BroadcastChannel coordination');
    return locks.request('arena-chipnet-settlement:'+category,{ifAvailable:true},async lock=>{if(!lock)return false;await work();return true;});
  });
  keeper.canBroadcast=()=>!!locks&&typeof BroadcastChannel!=='undefined'&&index.health.connected&&!index.health.stale;
  if(typeof BroadcastChannel!=='undefined') {
    controls=new BroadcastChannel('arena-chipnet-settlement-retry-v2');
    controls.onmessage=event=>{control(event.data);refresh?.();};
  }
  let verified=false, cached: ReturnType<typeof indexEnvelope> | undefined, leader=false;
  const publish = () => {
    const envelope=indexEnvelope({...index, vaults:index.displayVaults ?? index.vaults, tip:index.tip, displayError:index.displayError, minDisplayConfirmations:config.minDisplayConfirmations ?? 0});
    const value = !verified && cached ? {...cached,health:envelope.health} : envelope;
    const packet={type:'snapshot',envelope:value,cached:!verified,role:leader?'leader':'waiting',keeper:{automatic:true,statuses:keeper.statuses}};
    scope.postMessage(packet);
    if(leader)channel?.postMessage(packet);
  };
  try {
    await index.load();
    index.health.updatedAt=store.cached?.updatedAt ?? '';
    if(store.cached?.vaults && index.blocks.length) cached=indexEnvelope({...index,vaults:store.cached.vaults.filter(v => index.tip!.height-v.transaction.height+1 >= Math.max(1,config.minDisplayConfirmations ?? 0)),tip:index.tip});
  } catch(error) { index.blocks=[]; index.health.error=`Saved checkpoint unavailable; rebuilding. ${String(error)}`; }
  if (locks && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(lockName);
    channel.onmessage = event => {
      if(event.data?.type==='snapshot' && !leader) scope.postMessage({...event.data,role:'follower',keeper:{...event.data.keeper,automatic:true}});
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
      busy=true;const manual=[...requested][0];clearTimeout(timer);publish();
      try {
        await keeper.tick();
        verified=true;failures=0;
      }
      catch { failures++; /* The shared indexer retains the last successful state and sets stale/error. */ }
      finally { if(manual)requested.delete(manual);busy=false;publish();timer=setTimeout(()=>{void poll();},requested.size||Object.entries(keeper.statuses).some(([category,s])=>s.phase==='confirmed'&&index.vaults.some(v=>v.category===category&&Buffer.from(v.witness,'hex').readUInt32LE(0)<v.config.periods))?1000:Math.min(60000,config.pollMs*(2**Math.min(failures,3)))); }
    };
    index.onChange=publish;keeper.onChange=publish; refresh=()=>{void poll();}; await poll();
    // The browser releases this lock, WSS sockets and worker resources when the owning tab closes.
    await new Promise<void>(()=>{});
  };
  if(locks) await locks.request(lockName,{mode:'exclusive'},run);
  else await run();
}
