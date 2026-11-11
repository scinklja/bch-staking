import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { browserConfig, indexerSource } from '../src/browserConfig';
import { useArena } from '../src/useArena';
import { fixture } from './fixture';

afterEach(()=>vi.unstubAllEnvs());
it('defaults static builds to browser Electrum, retains explicit API/off modes and rejects mainnet/unsafe config',()=>{
  expect(indexerSource(null)).toBe('electrum');expect(indexerSource('/api')).toBe('api');
  expect(indexerSource(null,'off')).toBe('off');expect(indexerSource('/api','electrum')).toBe('electrum');
  expect(()=>indexerSource(null,'wrong')).toThrow();
  const config=browserConfig({});expect(config.network).toBe('chipnet');expect(config.endpoints).toHaveLength(2);expect(config.vaults).toHaveLength(1);
  for(const env of [{VITE_ARENA_NETWORK:'mainnet'},{VITE_ELECTRUM_ENDPOINTS:'ws://localhost:50004'},{VITE_ELECTRUM_ENDPOINTS:'wss://user:secret@localhost:50004'},{VITE_ARENA_VAULTS:'[{}]'},{VITE_ELECTRUM_MAX_HISTORY:'0'},{VITE_ELECTRUM_POLL_MS:'1'}]) expect(()=>browserConfig(env)).toThrow();
});
it('uses worker envelopes, labels cached state, displays errors, refreshes and terminates cleanly without HTTP',async()=>{
  vi.stubEnv('VITE_INDEXER_MODE','electrum');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  let worker: FakeWorker;
  class FakeWorker {
    onmessage?: (event: MessageEvent)=>void;onerror?: (event: ErrorEvent)=>void;
    postMessage=vi.fn();terminate=vi.fn();constructor(){worker=this;}
  }
  vi.stubGlobal('Worker',FakeWorker);
  const hook=renderHook(()=>useArena());
  expect(worker!.postMessage).not.toHaveBeenCalled();
  act(()=>worker!.onmessage?.({data:{type:'ready'}} as MessageEvent));
  expect(worker!.postMessage.mock.calls[0][0].type).toBe('start');
  const data={...fixture(),chain:'chipnet',health:{connected:false,error:'',updatedAt:new Date().toISOString(),stale:true,phase:'Connecting',syncing:true}};
  act(()=>worker!.onmessage?.({data:{type:'snapshot',envelope:data,cached:true,role:'waiting'}} as MessageEvent));
  expect(hook.result.current.fromSnapshot).toBe(true);expect(hook.result.current.pending).toBe(true);
  act(()=>worker!.onmessage?.({data:{type:'snapshot',envelope:{...data,health:{...data.health,connected:true,stale:false,syncing:false,phase:'Synchronized'}},cached:false,role:'follower'}} as MessageEvent));
  await waitFor(()=>expect(hook.result.current.fromSnapshot).toBe(false));expect(hook.result.current.providerStatus).toContain('following another tab');
  act(()=>hook.result.current.refresh());expect(worker!.postMessage).toHaveBeenLastCalledWith({type:'refresh'});
  act(()=>worker!.onmessage?.({data:{type:'error',error:'IndexedDB unavailable'}} as MessageEvent));expect(hook.result.current.error).toContain('IndexedDB unavailable');
  hook.unmount();expect(worker!.terminate).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
});
