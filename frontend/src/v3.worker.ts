/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {AssetIndexer} from '../../src/v3/indexer';
import {inspectClaim,RewardClaimer,BrowserClaimStore} from '../../src/v3/claim';
import {AssetWallet,BrowserAssetStore} from '../../src/v3/wallet';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let queue=Promise.resolve();
scope.onmessage=event=>{queue=queue.catch(()=>{}).then(async()=>{const {id,intent,keys=[]}=event.data;try{
 const endpoints=String(import.meta.env.VITE_V3_REGTEST_ENDPOINTS??'wss://127.0.0.1:4177,wss://localhost:4177').split(',');
 const provider=new BrowserElectrumProvider({network:'regtest',endpoints,allowBroadcast:true,maxTipAgeSeconds:2147483647}),wallet=new AssetWallet(provider,new BrowserAssetStore());
 const run=async()=>{
  if(intent.operation==='list')return wallet.store.list();
  if(intent.operation==='sync')return inspectClaim(new AssetIndexer(provider,intent.config));
  if(intent.operation==='claim')return wallet.claim(intent.config,keys);
  if(intent.operation==='reconcileClaim')return new RewardClaimer(new AssetIndexer(provider,intent.config),new BrowserClaimStore()).reconcile(intent.id,false);
  if(intent.operation==='claims')return new BrowserClaimStore().list();
  if(intent.operation==='create')return wallet.create(intent.parameters,keys);
  if(intent.operation==='offer')return wallet.offer(intent.config,intent.terms,keys);
  if(intent.operation==='action')return wallet.action(intent.config,intent.action,intent.slot,keys);
  if(intent.operation==='withdraw')return wallet.withdraw(intent.config,intent.allocation,keys);
  if(intent.operation==='resume'||intent.operation==='inspect')return wallet.resume(intent.id);
  if(intent.operation==='signingFailed')return wallet.signingFailed(intent.id,String(intent.error));
  if(intent.operation==='authorize')return wallet.authorize(intent.id);
  if(intent.operation==='submit')return wallet.submit(intent.id,intent.raw);
  if(intent.operation==='rebroadcast')return wallet.rebroadcast(intent.id);
  if(intent.operation==='rebroadcastFunding')return wallet.rebroadcastFunding(intent.id);
  if(intent.operation==='discard')return wallet.discard(intent.id);
  throw Error('Unknown v3 operation');
 };
 if(!scope.navigator.locks)throw Error('V3 requires Web Locks');
 const result=await scope.navigator.locks.request('arena-regtest-v3',{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is updating v3');return run();});scope.postMessage({id,result});
 }catch(e){scope.postMessage({id,error:String(e)});}});};
scope.postMessage({type:'ready'});
