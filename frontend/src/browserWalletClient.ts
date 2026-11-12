import type {DappConnectionManager} from '@wizardconnect/dapp';
import {binToHex} from '@bitauth/libauth';
import type {WalletOperation} from '../../src/browser-wallet';
import type {WalletKey} from '../../src/transactions-core';
import {browserConfig} from './browserConfig';
import {wizardWireTransaction,type WalletTransactions} from './walletTransactions';
import {saveLocalVault} from './vaultCatalog';
/** The worker builds/verifies public transactions. Only the live wallet manager ever signs. */
export function browserWalletClient(manager:DappConnectionManager|null,check:()=>void):WalletTransactions {
 const getManager=()=>{if(!manager)throw Error('Connect a chipnet wallet first');return manager;};
 const worker=new Worker(new URL('./wallet.worker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let counter=0,scanLimit=40,closed=false;const signing=new AbortController();let startupTimer:ReturnType<typeof setTimeout>|undefined,startupReject:(e:Error)=>void=()=>{};let derived:WalletKey[]|undefined,derivationIdentity="";
 const rpc=(method:string,...args:unknown[])=>new Promise<any>((resolve,reject)=>{if(closed){reject(Error('Wallet session closed; reconnect and resume from the journal'));return;}const id=++counter;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});
 const startup=new Promise<void>((resolve,reject)=>{startupReject=reject;const timer=startupTimer=setTimeout(()=>reject(Error('Wallet worker startup timeout')),30000);worker.onmessage=event=>{if(event.data?.type==='operation'){window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:event.data.operation}));return;}if(event.data?.type==='progress'){window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:event.data.message}));return;}if(event.data?.type==='ready'){clearTimeout(timer);try{void rpc('start',browserConfig()).then(()=>resolve(),reject);}catch(error){reject(error);}return;}const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);event.data.error?task.reject(Error(event.data.error)):task.resolve(event.data.result);};});
 void startup.catch(()=>{});
 worker.onerror=()=>{clearTimeout(startupTimer);startupReject(Error('Wallet worker failed; reconnect and resume'));for(const task of pending.values())task.reject(Error('Wallet worker failed; reload and resume from the journal'));pending.clear();};
 const keys=()=>{check();const identity=JSON.stringify(getManager().getSessionPaths())+scanLimit;if(derived&&identity===derivationIdentity)return derived;const result:WalletKey[]=[];for(const [path,child] of [['receive',0],['change',1],['defi',7]] as const){if(!getManager().hasPath(child))continue;for(let index=0;index<scanLimit;index++){const key=getManager().getPubkey(child,BigInt(index));if(!key)throw Error('Wallet public derivation failed');result.push({path,index,publicKey:binToHex(key)});}}derived=result;derivationIdentity=identity;return result;};
 async function finish(op:WalletOperation) {
  if(op.step==='complete'&&op.config){const verified=await rpc('importVault',op.config);saveLocalVault(verified.config,verified.category);}
  window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:op}));
  return {txid:op.txid??'',status:op.stage,operation:op};
 }
 return {browser:true,async v2(intent){
   await startup;
   if(['list','sync'].includes(String(intent.operation)))return rpc('v2',intent,[]);
   const session=JSON.stringify(getManager().getSessionPaths());
   const result=await rpc('v2',intent,['list','sync','resume'].includes(String(intent.operation))?[]:keys());
   if(!result?.plan||result.stage!=='review')return result;
   check();if(result.owner?.publicKey!==binToHex(getManager().getPubkey(0,0n)??new Uint8Array()))throw Error('Resume with the original v2 wallet owner');
   if(typeof getManager().signTransaction!=='function')throw Error('Wallet does not support transaction signing');
   if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before v2 approval');
   const signed=await getManager().signTransaction({transaction:wizardWireTransaction(result.plan.request),inputPaths:result.plan.inputPaths},{signal:signing.signal});
   check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during v2 approval');
   if(signed.error||!signed.signedTransaction)throw Error('V2 signing refused; operation remains recoverable');
   return rpc('v2',{operation:'submit',id:result.id,raw:signed.signedTransaction},[]);
  },publicKey(){check();const key=getManager().getPubkey(0,0n);if(!key)throw Error('Wallet receive key unavailable');return binToHex(key);},async inventory(limit=40){if(![40,200].includes(limit))throw Error("Unsupported scan bound");scanLimit=limit;await startup;return rpc('scan',keys());},async operations(){await startup;return rpc('list');},async inspect(id){await startup;const op=await rpc('get',id) as WalletOperation;if(op.step==='complete')await finish(op);return op;},async importVault(config){await startup;const result=await rpc('importVault',config);saveLocalVault(result.config,result.category);return result;},async execute(intent){
  await startup;let op:WalletOperation;
  if(intent.kind==='cancel')return finish(await rpc('cancel',intent.id));
  if(intent.kind==='recover')return finish(await rpc('recover',intent.parameters,intent.pregenesis));
  if(intent.kind==='resume'){const stored=await rpc('get',intent.id) as WalletOperation;if(stored.kind==='create'&&stored.txid&&(stored.stage==='confirmed'||['genesis','complete'].includes(stored.step)))return finish(await rpc('advance',intent.id,[]));}
  const publicKeys=keys(),session=JSON.stringify(getManager().getSessionPaths());
  if(intent.kind==='create')op=await rpc('create',intent.parameters,publicKeys);
  else if(intent.kind==='offer')op=await rpc('offer',intent.config,intent.terms,publicKeys);
  else if(intent.kind==='resume')op=await rpc('advance',intent.id,publicKeys);
  else throw Error('Unsupported browser wallet operation');
  if(op.stage==='review'&&op.plan){
   check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before approval');
   window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:op}));
   window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Awaiting explicit wallet approval for '+op.plan.label}));
   const signed=await getManager().signTransaction({transaction:wizardWireTransaction(op.plan.request),inputPaths:op.plan.inputPaths},{signal:signing.signal});
   check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during approval');
   if(signed.error||!signed.signedTransaction)throw Error('Wallet rejected signing. The unsigned operation remains resumable.');
   window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Validating signed transaction and checking current chipnet inputs before broadcast'}));
   op=await rpc('submit',op.id,signed.signedTransaction,publicKeys);
  }
  return finish(op);
 },close(){closed=true;clearTimeout(startupTimer);startupReject(Error('Wallet worker closed'));signing.abort();worker.terminate();for(const t of pending.values())t.reject(Error('Wallet disconnected; operation journal preserved'));pending.clear();}};
}
