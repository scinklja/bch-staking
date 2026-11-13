import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Contract,SignatureTemplate,TransactionBuilder,type SpendableUtxo} from 'cashscript';
import {decodeTransaction,hexToBin,binToHex,encodeTransaction,type Transaction} from '@bitauth/libauth';
import {rpc,assertRegtest} from '../src/rpc.js';
import {TokenRegtestProvider} from '../src/token-provider.js';
import {utxo,rankings} from '../src/arena-core.js';
import {offer,remainingCommitment} from '../src/registry.js';
import {assetOutput,covenant,parameterArgs,genesisBuilder,transitionBuilder,sponsorAmount,withdrawalBuilder,validateBuilt,validateInstance,rewardRemaining,buffer,decision,initialState,advance,validateTerms,allocationSequence,type Asset,type Parameters,type Instance} from '../src/v3/protocol.js';
const bchAsset:Asset={kind:'bch'};
test('v3 pure model: accumulation, live ranks, head blockage, seconds and bounds',()=>{
 const p:Parameters={version:3,stakingAsset:bchAsset,rewardAsset:bchAsset,epoch:1800000000,periodSeconds:3600,periods:10,cap:1000n},key=new SignatureTemplate(new Uint8Array(32).fill(81)).publicKey;
 let s=initialState(p);assert.equal(buffer(p,s,p.epoch-1),0n);assert.equal(buffer(p,s,p.epoch),0n);assert.equal(buffer(p,s,p.epoch+3599),0n);assert.equal(buffer(p,s,p.epoch+3600),1000n);assert.equal(buffer(p,s,p.epoch+10800),3000n);
 assert.equal(decision({parameters:p,state:s},{mtp:p.epoch+7201}).phase,'blocked');
 s=advance(s,0,0,offer(key,3000,512,4000,2));assert.equal(decision({parameters:p,state:s},{mtp:p.epoch+7201}).phase,'blocked');
 s=advance(s,0,1,offer(key,6000,512,4000,2));assert.equal(rankings(s)[0]!.slot,1);assert.throws(()=>advance(s,3,0));
 s=advance(s,3,1);s=advance(s,3,1);assert.equal(rankings(s)[0]!.slot,0);assert.equal(rewardRemaining(s),2000n);
 assert.match(decision({parameters:p,state:s},{mtp:p.epoch+100000}).phase==='blocked'? (decision({parameters:p,state:s},{mtp:p.epoch+100000}) as any).reason:'',/remaining reserve/);
 assert.throws(()=>validateTerms(p,{stake:3000n,duration:512,reward:3000n,maxWins:1},2000n));
 assert.equal(allocationSequence(513),0x400002);assert.equal(allocationSequence(33553920),0x40ffff);
 s=advance(s,1,0);s=advance(s,4,0);assert.equal(remainingCommitment(s),0n);
 for(const a of [2,5,99])assert.throws(()=>advance(s,a));
});
test('v3 BCHN regtest: four asset pairs, continuous claims, locks, conflicts and reorgs',{timeout:1800000},async()=>{
 await assertRegtest();const provider=new TokenRegtestProvider(),owner=new SignatureTemplate(new Uint8Array(32).fill(81));
 const deposit=new Contract(JSON.parse(await readFile('artifacts/RegistryDeposit.json','utf8')),[owner.publicKey],{provider,contractType:'p2sh32'});
 const anyone=new Contract(JSON.parse(await readFile('artifacts/Example.json','utf8')),[42n],{provider,contractType:'p2sh32'});
 const mining=await rpc<string>('getnewaddress'),mine=()=>rpc<string[]>('generatetoaddress',[1,mining]),evidence:any[]=[];
 async function clock(){const i=await rpc('getblockchaininfo');return {height:i.blocks,mtp:i.mediantime};}
 async function warp(t:number){await rpc('setmocktime',[t]);await rpc('generatetoaddress',[11,mining]);assert.ok((await clock()).mtp>=t);}
 async function out(id:string,n=0){return utxo(await rpc('getrawtransaction',[id,true]),n);}
 async function funding(n:bigint,script=deposit){const id=await rpc<string>('sendtoaddress',[script.address,Number(n)/1e8]),tx=await rpc('getrawtransaction',[id,true]);return utxo(tx,tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===script.lockingBytecode&&Math.round(o.value*1e8)===Number(n)));}
 const unlock=(input:SpendableUtxo)=>({input,unlocker:deposit.unlock.spend(owner)});
 async function send(raw:string,label:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,true,label+JSON.stringify(a));const id=await provider.sendRawTransaction(raw);await mine();console.log(label);evidence.push({label,txid:id,bytes:raw.length/2});return id;}
 async function reject(raw:string,label:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,false,label);evidence.push({label,rejected:a['reject-reason']});}
 async function mint(){const f=await funding(10020000n),pre=await new TransactionBuilder({provider}).addInput(f,deposit.unlock.spend(owner)).addOutput({to:deposit.address,amount:10010000n}).send();const t=await new TransactionBuilder({provider}).addInput(await out(pre.txid),deposit.unlock.spend(owner)).addOutput({to:deposit.tokenAddress,amount:10000000n,token:{category:pre.txid,amount:1000000000n}}).send();let supply=await out(t.txid);await mine();return {asset:{kind:'token',category:pre.txid} as Asset,async take(n:bigint){const t=await new TransactionBuilder({provider}).addInput(supply,deposit.unlock.spend(owner)).addOutput({to:deposit.tokenAddress,amount:1000n,token:{category:pre.txid,amount:n}}).addOutput({to:deposit.tokenAddress,amount:supply.satoshis-11000n,token:{category:pre.txid,amount:supply.token!.amount-n}}).send();supply=await out(t.txid,1);return out(t.txid);}};}
 const a=await mint(),b=await mint();
 async function funds(asset:Asset,n:bigint,base=1000n){return asset.kind==='bch'?funding(n+base):(asset.category===(a.asset as any).category?a:b).take(n);}
 for(const [stakingAsset,rewardAsset] of [[bchAsset,bchAsset],[bchAsset,b.asset],[a.asset,bchAsset],[a.asset,b.asset],[a.asset,a.asset]] as [Asset,Asset][]){
  const label=`${stakingAsset.kind}->${rewardAsset.kind}`,start=(await clock()).mtp+1000,p:Parameters={version:3,stakingAsset,rewardAsset,epoch:start,periodSeconds:1000,periods:4,cap:rewardAsset.kind==='bch'?2000n:10n};
  const factory=covenant('RegistryGenesisV3',parameterArgs(p),provider),pre=await new TransactionBuilder({provider}).addInput(await funding(22000n),deposit.unlock.spend(owner)).addOutput({to:factory.address,amount:12000n}).send(),g=genesisBuilder(p,await out(pre.txid),unlock(await funds(rewardAsset,p.cap*4n)),provider);
  const id=await send(g.builder.build(),label+' full reserve genesis');let v:Instance={parameters:p,category:pre.txid,state:g.state,inputs:[await out(id),await out(id,1),await out(id,2)]};
  function binToHexRaw(built:ReturnType<typeof transitionBuilder>){return built.builder.build();}
  const allocations:{input:SpendableUtxo;terms:Buffer;anchor:number}[]=[];
  const terms={stake:3000n,duration:513,reward:p.cap*2n,maxWins:2};
  async function build(action:number,slot=0,t=terms,permissionless=false){const c=await clock(),sponsorInput=await funding(sponsorAmount(v,action),permissionless?anyone:deposit),sponsor=permissionless?{input:sponsorInput,unlocker:anyone.unlock.spend(42n)}:unlock(sponsorInput),registration=action===0?{owner:owner.publicKey,terms:t,funding:unlock(await funds(stakingAsset,t.stake*BigInt(t.maxWins),0n))}:undefined;return {...transitionBuilder(v,action,slot,provider,c,sponsor,permissionless?undefined:owner,registration),clock:c};}
  async function apply(built:Awaited<ReturnType<typeof build>>,name:string){const raw=built.builder.build();validateBuilt(raw,built.sources,built.clock);const anchor=(await clock()).mtp,id=await send(raw,label+' '+name);if(built.terms)allocations.push({input:await out(id,4),terms:built.terms,anchor});v={...v,state:built.state,inputs:[await out(id),await out(id,1),await out(id,2)]};validateInstance(v,provider);return {raw,id};}
  await apply(await build(0),'register before releases');assert.equal(buffer(p,v.state,(await clock()).mtp-1),0n);await assert.rejects(build(3),/buffer/);
  await warp(start+1001);assert.equal(buffer(p,v.state,(await clock()).mtp-1),p.cap);await assert.rejects(build(3),/buffer/);
  await warp(start+3001);assert.equal(buffer(p,v.state,(await clock()).mtp-1),p.cap*3n);
  await apply(await build(0,1,{...terms,stake:6000n}),'register after accumulation, displace head');assert.equal(rankings(v.state)[0]!.slot,1);await assert.rejects(build(3,0),/changed/);
  await apply(await build(0,2,{...terms,stake:6000n}),'register exact tie between releases');assert.equal(rankings(v.state)[0]!.slot,1);
  const competing=await build(3,1,terms,true);
  const candidate=decodeTransaction(hexToBin(competing.builder.build()));if(typeof candidate==='string')throw Error(candidate);
  async function malicious(name:string,change:(tx:Transaction)=>void){const bad=structuredClone(candidate as Transaction);change(bad);await reject(binToHex(encodeTransaction(bad)),label+' covenant rejects '+name);}
  await malicious('insufficient virtual buffer with backdated final locktime',tx=>{tx.locktime=p.epoch+1000;});
  await malicious('noncanonical transaction version',tx=>{tx.version=1;});
  await malicious('unexpected relative source sequence',tx=>{tx.inputs[1]!.sequenceNumber=0;});
  await malicious('pre-schedule timestamp',tx=>{tx.locktime=p.epoch-1;});
  await malicious('future release spending',tx=>{tx.locktime=p.epoch+4000;});
  await malicious('final-sequence timing bypass',tx=>{tx.locktime=p.epoch+4000;for(const input of tx.inputs)input.sequenceNumber=0xffffffff;});
  await malicious('reward diversion',tx=>{tx.outputs[3]!.lockingBytecode=tx.outputs[4]!.lockingBytecode;});
  await malicious('state carrier theft',tx=>{tx.outputs[0]!.valueSatoshis--;});
  await malicious('allocation theft',tx=>{tx.outputs[4]!.valueSatoshis--;});
  await malicious('reserve theft',tx=>{tx.outputs[2]!.valueSatoshis--;});
  await malicious('double allocation output',tx=>{tx.outputs.push(structuredClone(tx.outputs[4]!));});
  if(rewardAsset.kind==='token')await malicious('reward token burn',tx=>{tx.outputs[3]!.token!.amount--;});
  const first=await apply(await build(3,1,terms,true),'permissionless reward claim without owner signature');assert.equal(rewardRemaining(v.state),p.cap*2n);await reject(binToHexRaw(competing),label+' competing independently funded claim');await reject(first.raw,label+' conflicting duplicate claim');await assert.rejects(build(3,1),/buffer/);
  assert.equal(remainingCommitment(v.state),24000n);
  const lock=allocations[0]!,fee=unlock(await funding(10000n)),withdraw=withdrawalBuilder(lock.input,lock.terms,owner,fee,provider),early=(withdraw as any).buildLibauthTransaction(true);
  await reject(binToHex(encodeTransaction(early)),label+' rejects premature relative withdrawal');
  assert.throws(()=>validateBuilt(binToHex(encodeTransaction(early)),[lock.input,fee.input],{height:1,mtp:lock.anchor},lock.anchor));
  await warp(start+4001);const second=await apply(await build(3,1,terms,true),'second win removes head');assert.equal(rankings(v.state)[0]!.slot,2);assert.equal(rewardRemaining(v.state),0n);await assert.rejects(build(0,3),/reserve/);
  await apply(await build(1,2),'cancel blocked tied offer');await apply(await build(4,2),'refund unused stake');assert.equal(allocations.length,2);assert.notEqual(allocations[0]!.terms.toString('hex'),allocations[1]!.terms.toString('hex'));
  await apply(await build(1,0),'cancel original offer');await apply(await build(4,0),'refund original offer');assert.equal(remainingCommitment(v.state),0n);
  await warp((await clock()).mtp+1100);
  for(const allocation of allocations){const sponsor=unlock(await funding(10000n)),w=withdrawalBuilder(allocation.input,allocation.terms,owner,sponsor,provider),raw=w.build();validateBuilt(raw,[allocation.input,sponsor.input],await clock(),allocation.anchor);await send(raw,label+' independent relative withdrawal');await reject(raw,label+' duplicate allocation withdrawal');}
  const tx=await rpc('getrawtransaction',[second.id,true]);try{await rpc('invalidateblock',[tx.blockhash]);assert.ok(await rpc('gettxout',[first.id,0,false]));}finally{await rpc('reconsiderblock',[tx.blockhash]);}assert.ok((await rpc('getrawtransaction',[first.id,true])).confirmations>0);evidence.push({label,reorgRestored:true});
 }
 await writeFile('docs/staking-arena-v3-results.json',JSON.stringify({network:'regtest',node:(await rpc('getnetworkinfo')).subversion,verifiedAt:new Date().toISOString(),evidence},null,2)+'\n');
});
