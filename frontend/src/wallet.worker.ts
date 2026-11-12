/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {ElectrumIndexer} from '../../src/indexer-core';
import {BrowserWallet} from '../../src/browser-wallet';
import {IndexedDbWalletOperations} from '../../src/wallet-store';
import type {BrowserIndexerConfig} from './browserConfig';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let engine:BrowserWallet|undefined,queue:Promise<unknown>=Promise.resolve();
scope.onmessage=event=>{
 const {id,method,args}=event.data??{};
 queue=queue.catch(()=>{}).then(async()=>{
  try {
   if(method==='start') {const config=args[0] as BrowserIndexerConfig;if(config.network!=='chipnet')throw Error('Chipnet only');engine=new BrowserWallet(new ElectrumIndexer([...config.vaults],new BrowserElectrumProvider({...config,allowBroadcast:true})),new IndexedDbWalletOperations());engine.onOperation=operation=>scope.postMessage({type:'operation',operation});engine.onProgress=message=>scope.postMessage({type:'progress',message});scope.postMessage({id,result:true});return;}
   if(!engine)throw Error('Wallet worker not ready');
   if(!['cancel','list','scan','create','offer','submit','get','advance','recover','importVault'].includes(method))throw Error('Unsupported wallet operation');
   const run=async()=>{const result=await (engine![method as keyof BrowserWallet] as Function).apply(engine,args??[]);scope.postMessage({id,result});};
   // Status reconciliation also writes the journal. Serialize it with submission
   // so a second tab cannot overwrite a newly saved signed transaction with an old status.
   if(['cancel','create','offer','submit','get','advance','recover'].includes(method)) {
    if(!scope.navigator.locks)throw Error('Wallet transactions require Web Locks');
    // One local wallet submission at a time; independent users still rely on BCH conflict validation.
    await scope.navigator.locks.request('arena-chipnet-wallet-submission',{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is processing a wallet transaction; wait and reconcile');await run();});
   } else await run();
  }catch(error){scope.postMessage({id,error:String(error)});}
 });
};
scope.postMessage({type:'ready'});
