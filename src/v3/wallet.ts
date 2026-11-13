import {Network,TransactionBuilder,placeholderP2PKHUnlocker,placeholderSignature,type SpendableUtxo,type NetworkProvider} from 'cashscript';
import {hexToBin,binToHex,createVirtualMachineBch2026,hashTransaction,decodeTransaction,encodeCashAddress,hash160,type Transaction} from '@bitauth/libauth';
import {Buffer} from '../bytes.js';
import {walletScript,validateWalletSigned,walletPlanIdentity,type BrowserPlan,type WalletKey,type WalletCoin} from '../transactions-core.js';
import {chooseBch,chooseTokens,scanWallet,verifyCoinsAcrossPeers,confirmedWalletTransaction} from '../electrum-wallet.js';
import type {ElectrumCore} from '../electrum-core.js';
import {utxo,records} from '../arena-core.js';
import {AssetIndexer,type Config,type Snapshot} from './indexer.js';
import {FEE,CARRIER,decision,assetOutput,covenant,parameterArgs,validateParameters,validateTerms,genesisBuilder,transitionBuilder,sponsorAmount,withdrawalBuilder,rewardRemaining,type Parameters,type Terms,type Asset} from './protocol.js';
export interface Operation {id:string;version:3;kind:'create'|'offer'|'action'|'withdraw'|'claim';step:'funding'|'action'|'complete';stage:'review'|'prepared'|'pending'|'confirmed'|'conflicted';parameters:Parameters;config?:Config;terms?:Terms;action?:number;slot?:number;allocation?:string;owner:WalletKey;payer?:WalletKey;source?:string;plan?:BrowserPlan;raw?:string;txid?:string;funding?:string;fundingRaw?:string;fundingPlan?:BrowserPlan;error?:string}
export interface Store {list():Promise<Operation[]>;save(value:Operation):Promise<void>}
function plan(builder:TransactionBuilder,label:string,coins:{coin:WalletCoin;index:number}[],authorization?:WalletKey):BrowserPlan {
 const request=builder.generateWcTransactionObject({broadcast:false,userPrompt:'V3 EXPERIMENTAL REGTEST FUNDS: '+label}),tx=request.transaction as Transaction;
 const signers:Record<number,string>={},inputPaths:BrowserPlan['inputPaths']=[];
 for(const {coin:c,index}of coins){if(c.utxo.lockingBytecode!==walletScript(c.publicKey))throw Error('Wallet key/source mismatch');signers[index]=c.publicKey;inputPaths.push([index,c.path,c.index]);}
 if(authorization){signers[0]=authorization.publicKey;inputPaths.unshift([0,authorization.path,authorization.index]);}
 const fee=request.sourceOutputs.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 return {kind:'offer',label,request,signers,inputPaths,fee:fee.toString()};
}
const keyCoin=(key:WalletKey,input:SpendableUtxo):WalletCoin=>({...key,utxo:input});
const sponsor=(key:WalletKey,input:SpendableUtxo)=>({input,unlocker:placeholderP2PKHUnlocker(walletAddress(hexToBin(key.publicKey)))});
function planCoins(plan:BrowserPlan):SpendableUtxo[]{
 const tx=plan.request.transaction as Transaction;return plan.request.sourceOutputs.map((s,n)=>({txid:Buffer.from(tx.inputs[n]!.outpointTransactionHash).toString('hex'),vout:tx.inputs[n]!.outpointIndex,satoshis:s.valueSatoshis,lockingBytecode:Buffer.from(s.lockingBytecode).toString('hex'),...(s.token?{token:{category:Buffer.from(s.token.category).toString('hex'),amount:s.token.amount,...(s.token.nft?{nft:{capability:s.token.nft.capability,commitment:Buffer.from(s.token.nft.commitment).toString('hex')}}:{})}}:{})}));
}
/** Check persisted funding plans as data before accepting wallet signatures. */
export function validateFundingPlan(op:Operation,provider:NetworkProvider){
 if(!op.plan||BigInt(op.plan.fee)!==FEE)throw Error('Unexpected v3 wallet fee');
 if(op.step!=='funding')return;
 const asset:Asset=op.kind==='create'?op.parameters.rewardAsset:op.kind==='offer'?op.parameters.stakingAsset:{kind:'bch'},category=asset.kind==='token'?asset.category:undefined;
 let inputTokens=0n,outputTokens=0n;
 for(const source of op.plan.request.sourceOutputs){if(source.token?.nft||source.token&&binToHex(source.token.category)!==category)throw Error('Unrelated tokens or NFTs in wallet funding');inputTokens+=source.token?.amount??0n;}
 const tx=op.plan.request.transaction as Transaction,owner=walletScript(op.owner.publicKey);
 const exact=(index:number,asset:Asset,units:bigint,base:bigint)=>{const output=tx.outputs[index],expected=assetOutput(asset,units,base);return output&&output.valueSatoshis===expected.amount&&(expected.token?output.token?.amount===expected.token.amount&&binToHex(output.token.category)===expected.token.category:!output.token);};
 if(op.kind==='create'){
  const factory=covenant('RegistryGenesisV3',parameterArgs(op.parameters),provider),first=tx.outputs[0];
  if(!first||first.token||first.valueSatoshis!==12000n||binToHex(first.lockingBytecode)!==factory.lockingBytecode||!exact(1,asset,op.parameters.cap*BigInt(op.parameters.periods),CARRIER))throw Error('Wallet preparation changes factory or full reward reserve');
 }else if(op.kind==='offer'){
  if(!op.terms||!exact(0,asset,validateTerms(op.parameters,op.terms),asset.kind==='bch'?0n:CARRIER)||!exact(1,{kind:'bch'},FEE-(asset.kind==='token'?CARRIER:0n),0n))throw Error('Wallet preparation changes exact stake or sponsor');
 }else{
  const extra=op.kind==='withdraw'?FEE:FEE+(op.action===3?(op.parameters.rewardAsset.kind==='token'?CARRIER:0n)+(op.parameters.stakingAsset.kind==='token'?CARRIER:0n):0n)+(op.action===4&&op.parameters.stakingAsset.kind==='token'?CARRIER:0n);
  if(!exact(0,{kind:'bch'},extra,0n))throw Error('Wallet preparation changes exact BCH sponsor');
 }

 for(const [i,output]of tx.outputs.entries()){
  if(output.token?.nft||output.token&&binToHex(output.token.category)!==category)throw Error('Unexpected wallet funding token output');outputTokens+=output.token?.amount??0n;
  if(!(op.kind==='create'&&i===0)&&binToHex(output.lockingBytecode)!==owner)throw Error('Wallet preparation diverts funding or change');
 }
 if(inputTokens!==outputTokens)throw Error('Wallet preparation must conserve all fungible tokens');
}
function validateIntent(op:Pick<Operation,'kind'|'parameters'> & Partial<Operation>,owner:WalletKey,snapshot:Snapshot){
 if(snapshot.pending.length)throw Error('Vault has pending spends');
 const state=snapshot.instance.state;
 if(op.kind==='offer'){if(state[5]!>=16)throw Error('Registration is closed');validateTerms(snapshot.config,op.terms!,rewardRemaining(state));return;}
 if(op.kind==='withdraw'){const a=snapshot.allocations.find(a=>a.id===op.allocation);if(!a||!a.mature||a.withdrawal||a.pending||a.terms.subarray(0,33).toString('hex')!==owner.publicKey)throw Error('Allocation unavailable, immature, or not owned');return;}
 if(op.action===1||op.action===4){const entry=records(state)[op.slot??0];if(!entry||entry.owner!==owner.publicKey)throw Error('Offer is not owned by this wallet');if(op.action===1&&entry.cancelled)throw Error('Offer is already cancelled');if(op.action===4&&(!entry.cancelled||entry.refunded||entry.wins>=entry.maxWins))throw Error('Remaining stake cannot be refunded in the current state');return;}
 const next=decision(snapshot.instance,snapshot.clock);if(next.phase!=='ready'||next.action!==op.action||next.slot!==(op.slot??0))throw Error('Claim head changed; refresh canonical state');
}
/** Funding actions use two approvals; claims use one atomic wallet-funded transaction. Journal public plans and signed bytes
 * before broadcast; retries reconcile the exact txid and never silently spend fresh coins.
 */
export class AssetWallet {
 constructor(readonly provider:ElectrumCore,readonly store:Store){if(provider.network!==Network.REGTEST)throw Error('V3 wallet is local regtest only');}
 async create(parameters:Parameters,keys:WalletKey[]){validateParameters(parameters);return this.prepare({kind:'create',parameters},keys);}
 async offer(config:Config,terms:Terms,keys:WalletKey[]){validateTerms(config,terms);return this.prepare({kind:'offer',parameters:config,config,terms},keys);}
 async action(config:Config,action:number,slot:number,keys:WalletKey[]){if(action===3)return this.claim(config,keys);if(![1,4].includes(action))throw Error('Invalid v3 action');return this.prepare({kind:'action',parameters:config,config,action,slot},keys);}
 async withdraw(config:Config,allocation:string,keys:WalletKey[]){return this.prepare({kind:'withdraw',parameters:config,config,allocation},keys);}
 /** One approval, one transaction. The caller need not own any offer. */
 async claim(config:Config,keys:WalletKey[]){
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Connect a compatible wallet with receive child zero');
  const snapshot=await new AssetIndexer(this.provider,config).sync(),next=decision(snapshot.instance,snapshot.clock);
  if(snapshot.pending.length)throw Error('A competing vault transaction is pending; refresh before claiming');
  if(next.phase!=='ready')throw Error(next.reason);
  const journal=await this.store.list();
  if(journal.some(o=>o.kind==='claim'&&o.config?.genesis===config.genesis&&o.step!=='complete'))throw Error('An existing claim needs reconciliation or explicit discard before another spend');
  const reserved=new Set(journal.filter(o=>o.step!=='complete').flatMap(o=>o.plan?planCoins(o.plan).map(i=>i.txid+':'+i.vout):[]));
  const inventory=await scanWallet(this.provider,keys),required=sponsorAmount(snapshot.instance,3);
  const coin=inventory.coins.filter(c=>!c.utxo.token&&!reserved.has(c.utxo.txid+':'+c.utxo.vout)&&(c.utxo.satoshis===required||c.utxo.satoshis>=required+CARRIER)).sort((a,b)=>a.utxo.satoshis<b.utxo.satoshis?-1:a.utxo.satoshis>b.utxo.satoshis?1:0)[0];
  if(!coin)throw Error(`Insufficient BCH: one confirmed token-free wallet coin must cover ${required} satoshis (miner fee ${FEE}, token carriers ${required-FEE}), with exact funding or at least 1000 satoshis change`);
  const clock=await verifyCoinsAcrossPeers(this.provider,[...snapshot.instance.inputs,coin.utxo]);
  if(clock.hash!==snapshot.tip.hash)throw Error('Chain changed during fee selection; refresh before authorizing');
  const built=transitionBuilder(snapshot.instance,3,next.slot,this.provider,clock,sponsor(coin,coin.utxo),undefined,undefined,{address:walletAddress(hexToBin(coin.publicKey))});
  const op:Operation={id:crypto.randomUUID(),version:3,kind:'claim',parameters:config,config,action:3,slot:next.slot,owner,payer:{publicKey:coin.publicKey,path:coin.path,index:coin.index},source:snapshot.instance.inputs[0].txid,step:'action',stage:'review',plan:plan(built.builder,`Claim reward to top offer #${next.slot}; caller pays miner fee ${FEE} sats + token carriers ${required-FEE} sats; change ${coin.utxo.satoshis-required} sats; no caller reward`,[{coin,index:3}])};
  await this.store.save(op);return op;
 }
 private async checkClaim(op:Operation){
  if(!op.config||!op.plan||!op.payer||op.source===undefined||op.slot===undefined||op.step!=='action')throw Error('Invalid saved claim');
  const snapshot=await new AssetIndexer(this.provider,op.config).sync();
  validateIntent(op,op.owner,snapshot);
  if(snapshot.instance.inputs[0].txid!==op.source)throw Error('Claim state changed; reconcile the conflicting claim');
  const coins=planCoins(op.plan),tx=op.plan.request.transaction as Transaction;
  if(coins.length!==4||coins[3]!.token||coins[3]!.lockingBytecode!==walletScript(op.payer.publicKey))throw Error('Invalid caller BCH input');
  const built=transitionBuilder(snapshot.instance,3,op.slot,this.provider,{height:snapshot.clock.height,mtp:tx.locktime+1},sponsor(op.payer,coins[3]!),undefined,undefined,{address:walletAddress(hexToBin(op.payer.publicKey))});
  const expected=plan(built.builder,op.plan.label,[{coin:keyCoin(op.payer,coins[3]!),index:3}]);
  if(walletPlanIdentity(op.plan)!==walletPlanIdentity(expected))throw Error('Saved claim changes the winner, fee, carriers, inputs or caller change');
  return snapshot;
 }
 private async resumeClaim(op:Operation){
  if(op.raw&&op.txid){
   try{const s=await new AssetIndexer(this.provider,op.config!).sync();
    const confirmed=s.history.includes(op.txid),pending=s.pending.includes(op.txid),conflict=!confirmed&&!pending&&s.instance.inputs[0].txid!==op.source;
    const next:Operation={...op,step:confirmed||conflict?'complete':'action',stage:confirmed?'confirmed':pending?'pending':conflict?'conflicted':'prepared',error:conflict?'A competing confirmed claim/state spend superseded this transaction':confirmed?undefined:'Signed transaction retained; only an explicit identical-byte retry is permitted'};
    await this.store.save(next);return next;
   }catch(e){const next:Operation={...op,step:'action',stage:'prepared',error:'Confirmation unavailable; signed claim retained: '+String(e)};await this.store.save(next);return next;}
  }
  if(op.step==='complete')return op;
  try{await this.checkClaim(op);return op;}catch(e){const next:Operation={...op,error:'Unsigned claim needs refresh/discard: '+String(e)};await this.store.save(next);throw e;}
 }
 private async prepare(request:Pick<Operation,'kind'|'parameters'> & Partial<Operation>,keys:WalletKey[]){
 const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Receive child zero required');
 const journal=await this.store.list(),reserved=new Set(journal.filter(o=>o.step!=='complete').flatMap(o=>o.plan?.request.transaction.inputs.map(i=>Buffer.from(i.outpointTransactionHash).toString('hex')+':'+i.outpointIndex)??[]));
 const inventory=await scanWallet(this.provider,keys),coins=inventory.coins.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout));
 let asset:Asset={kind:'bch'},amount=0n,base=0n,extra=FEE;
 if(request.kind==='create'){asset=request.parameters.rewardAsset;amount=request.parameters.cap*BigInt(request.parameters.periods);base=CARRIER;extra=12000n;}
 else if(request.kind==='offer'){asset=request.parameters.stakingAsset;amount=validateTerms(request.parameters,request.terms!);base=asset.kind==='token'?CARRIER:0n;const snapshot=await new AssetIndexer(this.provider,request.config!).sync();validateIntent(request,owner,snapshot);extra=sponsorAmount(snapshot.instance,0);}
 else {
  const snapshot=await new AssetIndexer(this.provider,request.config!).sync();validateIntent(request,owner,snapshot);extra=request.kind==='withdraw'?FEE:sponsorAmount(snapshot.instance,request.action!);
 }
 const required=base+(asset.kind==='bch'?amount:0n)+extra+FEE+CARRIER+(asset.kind==='token'?CARRIER:0n);
 let selected=asset.kind==='token'?chooseTokens(coins,asset.category,amount):[];selected=chooseBch(coins,required,selected);
 const total=selected.reduce((n,c)=>n+c.utxo.satoshis,0n),tokens=selected.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n),builder=new TransactionBuilder({provider:this.provider});
 for(const c of selected)builder.addInput(c.utxo,placeholderP2PKHUnlocker(walletAddress(hexToBin(c.publicKey))));
 let sent=extra;
 if(request.kind==='create'){const factory=covenant('RegistryGenesisV3',parameterArgs(request.parameters),this.provider);builder.addOutput({to:factory.address,amount:12000n}).addOutput({to:walletAddress(hexToBin(owner.publicKey)),...assetOutput(asset,amount,base)});sent+=base+(asset.kind==='bch'?amount:0n);}
 else if(request.kind==='offer'){builder.addOutput({to:walletAddress(hexToBin(owner.publicKey)),...assetOutput(asset,amount,base)}).addOutput({to:walletAddress(hexToBin(owner.publicKey)),amount:extra});sent+=base+(asset.kind==='bch'?amount:0n);}
 else builder.addOutput({to:walletAddress(hexToBin(owner.publicKey)),amount:extra});
 const tokenChange=asset.kind==='token'&&tokens>amount;
 if(tokenChange&&asset.kind==='token')builder.addOutput({to:walletAddress(hexToBin(owner.publicKey)),amount:CARRIER,token:{category:asset.category,amount:tokens-amount}});
 builder.addOutput({to:walletAddress(hexToBin(owner.publicKey)),amount:total-sent-FEE-(tokenChange?CARRIER:0n)});
 const op:Operation={...request,id:crypto.randomUUID(),version:3,kind:request.kind,parameters:request.parameters,owner,step:'funding',stage:'review',plan:plan(builder,`Prepare ${request.kind}: ${amount} ${asset.kind} raw units; external BCH funding ${extra}; fee ${FEE}`,selected.map((coin,index)=>({coin,index})))};
 await verifyCoinsAcrossPeers(this.provider,selected.map(c=>c.utxo));await this.store.save(op);return op;
 }
 async resume(id:string){let op=(await this.store.list()).find(o=>o.id===id);if(!op)throw Error('Unknown v3 operation');
 if(op.kind==='claim')return this.resumeClaim(op);
 if(op.raw&&op.txid){let status:any;
 try{status=await confirmedWalletTransaction(this.provider,op.txid);}catch(e){const uncertain={...op,step:op.step==='complete'?'action' as const:op.step,stage:'prepared' as const,error:'Confirmation unavailable; signed transaction retained: '+String(e)};await this.store.save(uncertain);return uncertain;}
 if(status.confirmations<=0){const pending={...op,step:op.step==='complete'?'action' as const:op.step,stage:'pending' as const,error:'Awaiting canonical confirmation; a previous confirmation may have been reorganized'};await this.store.save(pending);return pending;}
 if(op.step==='action'||op.step==='complete'){op={...op,step:'complete',stage:'confirmed',config:op.kind==='create'?{...op.parameters,genesis:op.txid}:op.config};await this.store.save(op);return op;}
 op={...op,funding:op.txid,fundingRaw:op.raw,fundingPlan:op.plan,stage:'confirmed',raw:undefined,txid:undefined,plan:undefined};await this.store.save(op);
 }
 if(op.step==='complete'||(op.plan&&op.step==='funding'))return op;
 // Unsigned action plans are rebuilt from fresh confirmed sources before each approval.
 if(op.plan){op={...op,plan:undefined,stage:'confirmed'};await this.store.save(op);}
 if(!op.funding)throw Error('Missing confirmed funding');
 const funding=await confirmedWalletTransaction(this.provider,op.funding);if(funding.confirmations<=0)throw Error('Funding must confirm first');
 let builder:TransactionBuilder,mapping:{coin:WalletCoin;index:number}[]=[],auth:WalletKey|undefined;
 const coin=(n:number)=>keyCoin(op!.owner,utxo(funding,n));
 if(op.kind==='create'){builder=genesisBuilder(op.parameters,utxo(funding,0),sponsor(op.owner,utxo(funding,1)),this.provider).builder;mapping=[{coin:coin(1),index:1}];}
 else {const snapshot=await new AssetIndexer(this.provider,op.config!).sync();validateIntent(op,op.owner,snapshot);
 if(op.kind==='withdraw'){const a=snapshot.allocations.find(a=>a.id===op!.allocation);if(!a||!a.mature||a.withdrawal||a.pending||a.terms.subarray(0,33).toString('hex')!==op.owner.publicKey)throw Error('Allocation unavailable, immature, or not owned');builder=withdrawalBuilder(a.input,a.terms,placeholderSignature(),sponsor(op.owner,coin(0).utxo),this.provider);mapping=[{coin:coin(0),index:1}];auth=op.owner;}
 else {const registration=op.kind==='offer'?{owner:hexToBin(op.owner.publicKey),terms:op.terms!,funding:sponsor(op.owner,coin(0).utxo)}:undefined,action=op.kind==='offer'?0:op.action!,slot=op.kind==='offer'?snapshot.instance.state[5]!:op.slot??0;
 const built=transitionBuilder(snapshot.instance,action,slot,this.provider,snapshot.clock,sponsor(op.owner,coin(op.kind==='offer'?1:0).utxo),[0,1,4].includes(action)?placeholderSignature():undefined,registration);builder=built.builder;
 mapping=op.kind==='offer'?[{coin:coin(0),index:3},{coin:coin(1),index:4}]:[{coin:coin(0),index:3}];if([0,1,4].includes(action))auth=op.owner;
 }}
 op={...op,step:'action',stage:'review',plan:plan(builder,`${op.kind} v3: ${JSON.stringify(op.parameters,(_,v)=>typeof v==='bigint'?v.toString():v)}`,mapping,auth)};await this.store.save(op);return op;
 }
 /** Read-only pre-approval validation. Never signs, sends or replaces a funding transaction. */
 async authorize(id:string){
 const op=(await this.store.list()).find(o=>o.id===id);
 if(!op?.plan||op.stage!=='review'||op.raw||op.txid)throw Error('V3 operation is not awaiting unsigned wallet approval');
 validateParameters(op.parameters);validateFundingPlan(op,this.provider);if(op.kind==='claim')await this.checkClaim(op);
 await verifyCoinsAcrossPeers(this.provider,planCoins(op.plan));
 return {plan:op.plan,owner:op.owner,verifiedAt:Date.now()};
 }
 async signingFailed(id:string,error:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op||op.raw||op.txid)return op;const next={...op,error:'Wallet authorization interrupted or refused: '+error.slice(0,500)};await this.store.save(next);return next;}
 async rebroadcastFunding(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op?.fundingRaw||!op.fundingPlan)throw Error('No saved signed funding transaction');
 validateFundingPlan({...op,step:'funding',plan:op.fundingPlan},this.provider);const inputs=planCoins(op.fundingPlan),clock=await verifyCoinsAcrossPeers(this.provider,inputs);validateWalletSigned(op.fundingPlan,op.fundingRaw,clock);
 await this.provider.session(async()=>{await verifyCoinsAcrossPinned(this.provider,inputs);await this.provider.sendRawTransaction(op.fundingRaw!);},clock.peer);
 const pending={...op,stage:'pending' as const,error:'Identical funding transaction retried; awaiting confirmation'};await this.store.save(pending);return pending;
 }
 async rebroadcast(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op?.raw||!op.plan||!op.txid||op.step==='complete')throw Error('No uncertain signed transaction');
 if(op.kind==='claim'){const checked=await this.resumeClaim(op);if(checked.stage==='confirmed'||checked.stage==='conflicted'||checked.stage==='pending')return checked;}
 const reviewed={...op,stage:'review' as const};await this.store.save(reviewed);return this.submit(id,op.raw);
 }
 async discard(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op||op.raw||op.txid)throw Error('Only unsigned operations may be discarded');if(op.kind==='create'&&op.funding)throw Error('A funded factory must remain recoverable; finish genesis instead of discarding it');const discarded={...op,step:'complete' as const,stage:op.kind==='claim'?'conflicted' as const:'confirmed' as const,plan:undefined,error:'Unsigned operation discarded; prepared wallet coins remain spendable'};await this.store.save(discarded);return discarded;}
 async submit(id:string,raw:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op?.plan||op.stage!=='review')throw Error('No reviewed v3 plan');
 validateFundingPlan(op,this.provider);if(op.kind==='claim')await this.checkClaim(op);if(op.step==='action'&&op.config)validateIntent(op,op.owner,await new AssetIndexer(this.provider,op.config).sync());const inputs=planCoins(op.plan);
 const clock=await verifyCoinsAcrossPeers(this.provider,inputs),validated=validateWalletSigned(op.plan,raw,clock,v3WalletValidation),prepared={...op,raw,txid:validated.txid,stage:'prepared' as const};await this.store.save(prepared);
 try {await this.provider.session(async()=>{await verifyCoinsAcrossPinned(this.provider,inputs);await this.provider.sendRawTransaction(raw);},clock.peer);const sent={...prepared,stage:'pending' as const};await this.store.save(sent);return sent;}catch(e){const uncertain={...prepared,error:String(e)};await this.store.save(uncertain);return uncertain;}
 }
}
async function verifyCoinsAcrossPinned(p:ElectrumCore,inputs:SpendableUtxo[]){for(const i of inputs)if(!(await p.getUtxosForLockingBytecode(i.lockingBytecode!)).some(u=>u.txid===i.txid&&u.vout===i.vout))throw Error('Input spent before broadcast');}
export class BrowserAssetStore implements Store {
 private db?:Promise<IDBDatabase>;
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('staking-arena-wallet-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('V3 journal blocked'));r.onsuccess=()=>resolve(r.result);});}
 async list(){const db=await this.open();return new Promise<Operation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async save(op:Operation){const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(op,op.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}


function v3WalletValidation(raw:string,sources:import('@bitauth/libauth').Output[],clock:import('../keeper-core.js').KeeperClock,fee?:bigint){
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed transaction');
 if(tx.version!==2||tx.locktime>=(tx.locktime<500000000?clock.height+1:clock.mtp))throw Error('Non-final transaction');
 if(sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n)!==fee)throw Error('Fee mismatch');
 const valid=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:sources});if(valid!==true)throw Error('Signed v3 covenant invalid: '+valid);
 return {txid:hashTransaction(hexToBin(raw)),transaction:tx,fee:fee!};
}

function walletAddress(key:Uint8Array){const a=encodeCashAddress({prefix:'bchreg',type:'p2pkhWithTokens',payload:hash160(key)});if(typeof a==='string')throw Error(a);return a.address;}
