/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {ElectrumIndexer} from '../../src/indexer-core';
import {BrowserWallet} from '../../src/browser-wallet';
import {IndexedDbWalletOperations} from '../../src/wallet-store';
import type {BrowserIndexerConfig} from './browserConfig';
import type {AssetWallet} from '../../src/v2/wallet';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let v2:AssetWallet|undefined,v2config:BrowserIndexerConfig|undefined;
let engine:BrowserWallet|undefined,queue:Promise<unknown>=Promise.resolve();
scope.onmessage=event=>{
 const {id,method,args}=event.data??{};
 queue=queue.catch(()=>{}).then(async()=>{
  try {
   if(method==='start') {const config=args[0] as BrowserIndexerConfig;if(config.network!=='chipnet')throw Error('Chipnet only');engine=new BrowserWallet(new ElectrumIndexer([...config.vaults],new BrowserElectrumProvider({...config,allowBroadcast:true})),new IndexedDbWalletOperations());v2config=config;engine.onOperation=operation=>scope.postMessage({type:'operation',operation});engine.onProgress=message=>scope.postMessage({type:'progress',message});scope.postMessage({id,result:true});return;}
   if(!engine)throw Error('Wallet worker not ready');
   if(method==='v2'){
    const {AssetWallet,BrowserAssetStore}=await import('../../src/v2/wallet');
    const {AssetIndexer}=await import('../../src/v2/indexer');
    const {AssetKeeper}=await import('../../src/v2/keeper');
    v2??=new AssetWallet(new BrowserElectrumProvider({...v2config!,allowBroadcast:true}),new BrowserAssetStore());
    const [intent,keys]=args;
    const run=async()=>{let result;
     if(intent.operation==='list')result=await v2!.store.list();
     else if(intent.operation==='sync')result=await new AssetIndexer(v2!.provider,intent.config).sync();
     else if(intent.operation==='create')result=await v2!.create(intent.parameters,keys);
     else if(intent.operation==='offer')result=await v2!.offer(intent.config,intent.terms,keys);
     else if(intent.operation==='keeper')result=await new AssetKeeper(new AssetIndexer(v2!.provider,intent.config),(config,action,slot)=>v2!.action(config,action,slot,keys)).process();
     else if(intent.operation==='action')result=await v2!.action(intent.config,intent.action,intent.slot,keys);
     else if(intent.operation==='withdraw')result=await v2!.withdraw(intent.config,intent.allocation,keys);
     else if(intent.operation==='resume')result=await v2!.resume(intent.id);
     else if(intent.operation==='rebroadcastFunding')result=await v2!.rebroadcastFunding(intent.id);
     else if(intent.operation==='rebroadcast')result=await v2!.rebroadcast(intent.id);
     else if(intent.operation==='discard')result=await v2!.discard(intent.id);
     else if(intent.operation==='submit')result=await v2!.submit(intent.id,intent.raw);
     else throw Error('Unknown v2 operation');
     scope.postMessage({id,result});
    };
    if(!scope.navigator.locks)throw Error('V2 wallet requires Web Locks');
    await scope.navigator.locks.request('arena-chipnet-wallet-submission',{ifAvailable:true},async lock=>{if(!lock)throw Error('Wallet busy in another tab');await run();});return;
   }
   if(!['authorize','cancel','list','scan','create','offer','submit','get','advance','recover','importVault'].includes(method))throw Error('Unsupported wallet operation');
   const run=async()=>{const result=await (engine![method as keyof BrowserWallet] as Function).apply(engine,args??[]);scope.postMessage({id,result});};
   // Status reconciliation also writes the journal. Serialize it with submission
   // so a second tab cannot overwrite a newly saved signed transaction with an old status.
   if(['authorize','cancel','create','offer','submit','get','advance','recover'].includes(method)) {
    if(!scope.navigator.locks)throw Error('Wallet transactions require Web Locks');
    // One local wallet submission at a time; independent users still rely on BCH conflict validation.
    await scope.navigator.locks.request('arena-chipnet-wallet-submission',{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is processing a wallet transaction; wait and reconcile');await run();});
   } else await run();
  }catch(error){scope.postMessage({id,error:String(error)});}
 });
};
scope.postMessage({type:'ready'});
