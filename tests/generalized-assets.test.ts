import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Contract,SignatureTemplate,TransactionBuilder,type SpendableUtxo} from 'cashscript';
import {binToHex,decodeTransaction,encodeTransaction,hexToBin,type Transaction} from '@bitauth/libauth';
import {rpc,assertRegtest} from '../src/rpc.js';
import {TokenRegtestProvider} from '../src/token-provider.js';
import {utxo,rankings} from '../src/arena-core.js';
import {remainingCommitment} from '../src/registry.js';
import {sourceOutput} from '../src/keeper-core.js';
import {assetOutput,covenant,parameterArgs,genesisBuilder,transitionBuilder,sponsorAmount,withdrawalBuilder,validateBuilt,validateInstance,rewardRemaining,exactPriority,initialState,type Asset,type Parameters,type Instance} from '../src/v2/protocol.js';

test('v2 real BCHN: four asset pairs and same-category tokens with protected balances', {timeout:1800000},async()=>{
 await assertRegtest();const provider=new TokenRegtestProvider(),owner=new SignatureTemplate(new Uint8Array(32).fill(61)),other=new SignatureTemplate(new Uint8Array(32).fill(62));
 const artifact=JSON.parse(await readFile('artifacts/RegistryDeposit.json','utf8')),deposit=new Contract(artifact,[owner.publicKey],{provider,contractType:'p2sh32'});
 const mining=await rpc<string>('getnewaddress'),mine=()=>rpc('generatetoaddress',[1,mining]),evidence:any[]=[];
 async function out(id:string,n=0){return utxo(await rpc('getrawtransaction',[id,true]),n);}
 async function bch(amount:bigint,to=deposit.address){const id=await rpc<string>('sendtoaddress',[to,Number(amount)/1e8]),tx=await rpc('getrawtransaction',[id,true]);return utxo(tx,tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===(to===deposit.address?deposit.lockingBytecode:o.scriptPubKey.hex)&&Math.round(o.value*1e8)===Number(amount)));}
 const unlock=(input:SpendableUtxo)=>({input,unlocker:deposit.unlock.spend(owner)});
 async function send(raw:string,label:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,true,label+': '+JSON.stringify(a));const id=await provider.sendRawTransaction(raw);evidence.push({label,txid:id,bytes:raw.length/2});await mine();return id;}
 async function reject(raw:string,label:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,false,label);evidence.push({label,rejected:a['reject-reason']});}
 async function mint(){const f=await bch(10020000n),pre=await new TransactionBuilder({provider}).addInput(f,deposit.unlock.spend(owner)).addOutput({to:deposit.address,amount:10010000n}).send();
 const tx=await new TransactionBuilder({provider}).addInput(await out(pre.txid),deposit.unlock.spend(owner)).addOutput({to:deposit.tokenAddress,amount:10000000n,token:{category:pre.txid,amount:1000000000n}}).send();let supply=await out(tx.txid);
 await mine();return {asset:{kind:'token',category:pre.txid} as Asset,async take(n:bigint){const tx=await new TransactionBuilder({provider}).addInput(supply,deposit.unlock.spend(owner)).addOutput({to:deposit.tokenAddress,amount:1000n,token:{category:pre.txid,amount:n}}).addOutput({to:deposit.tokenAddress,amount:supply.satoshis-11000n,token:{category:pre.txid,amount:supply.token!.amount-n}}).send();supply=await out(tx.txid,1);return out(tx.txid);}};}
 const a=await mint(),b=await mint(),native:Asset={kind:'bch'};
 async function funds(asset:Asset,n:bigint,base=1000n){return asset.kind==='bch'?bch(n+base):(asset.category===(a.asset as any).category?a:b).take(n);}
 for(const [stakingAsset,rewardAsset] of [[a.asset,native],[native,b.asset],[a.asset,b.asset],[native,native],[a.asset,a.asset]] as [Asset,Asset][]){
  const label=`${stakingAsset.kind}->${rewardAsset.kind}${stakingAsset.kind==='token'&&rewardAsset.kind==='token'&&stakingAsset.category===rewardAsset.category?' same-category':''}`;
  console.log('Testing',label);const info=await rpc('getblockchaininfo'),p:Parameters={version:2,stakingAsset,rewardAsset,epoch:info.mediantime-10000,periodSeconds:10,periods:3,cap:rewardAsset.kind==='bch'?2000n:10n};
  const factory=covenant('RegistryGenesisV2',parameterArgs(p),provider),fund=await bch(22000n),pre=await new TransactionBuilder({provider}).addInput(fund,deposit.unlock.spend(owner)).addOutput({to:factory.address,amount:12000n}).send();
  const rewardFunding=await funds(rewardAsset,p.cap*3n),g=genesisBuilder(p,await out(pre.txid),unlock(rewardFunding),provider);
  const genesisRaw=g.builder.build(),badGenesis=decodeTransaction(hexToBin(genesisRaw));if(typeof badGenesis==='string')throw Error(badGenesis);
  const badReserve=structuredClone(badGenesis);if(rewardAsset.kind==='bch')badReserve.outputs[2]!.valueSatoshis-=1n;else badReserve.outputs[2]!.token!.amount-=1n;
  await reject(binToHex(encodeTransaction(badReserve)),label+' underfunded genesis reserve');
  const genesis=await send(genesisRaw,label+' genesis');let v:Instance={parameters:p,category:pre.txid,state:g.state,inputs:[await out(genesis,0),await out(genesis,1),await out(genesis,2)]};
  validateInstance(v,provider);const allocations:{input:SpendableUtxo;terms:Buffer}[]=[];
  const terms={stake:3000n,duration:2,reward:rewardAsset.kind==='bch'?1000n:7n,maxWins:3};
  assert.deepEqual(exactPriority(terms),{numerator:6000n,denominator:terms.reward});
  async function build(action:number,slot=0,signer=owner,feeDelta=0n){const clock={height:(await rpc('getblockcount')),mtp:(await rpc('getblockchaininfo')).mediantime};const sponsor=unlock(await bch(sponsorAmount(v,action)+feeDelta)),registration=action===0?{owner:signer.publicKey,terms,funding:unlock(await funds(stakingAsset,9000n,0n))}:undefined;
   const built=transitionBuilder(v,action,slot,provider,clock,sponsor,signer,registration);return {...built,clock};}
  async function apply(built:Awaited<ReturnType<typeof build>>,name:string){console.log(label,name);const raw=built.builder.build();validateBuilt(raw,built.sources,built.clock);const usage=label==='token->bch'&&name==='settle first'?built.builder.getVmResourceUsage():undefined;evidence.push({label:label+' '+name,vm:usage});const id=await send(raw,label+' '+name);if(built.terms)allocations.push({input:await out(id,4),terms:built.terms});v={...v,state:built.state,inputs:[await out(id,0),await out(id,1),await out(id,2)]};validateInstance(v,provider);assert.equal(v.inputs[0].satoshis,1000n);return {raw,id};}
  await apply(await build(0,0),'register first');await apply(await build(0,1),'register exact tie');assert.equal(remainingCommitment(v.state),18000n);assert.equal(rankings(v.state)[0]!.slot,0);
  const extraEscrow=label==='token->bch'?126000n:0n;
  if(extraEscrow)for(let slot=2;slot<16;slot++)await apply(await build(0,slot),'register full-roster slot '+slot);
  await apply(await build(2),'activate');await reject(binToHex(encodeTransaction(((await build(3,1)).builder as any).buildLibauthTransaction(true))),label+' rejects later tied winner');
  const beforeCancel=Buffer.from(v.state.subarray(790,1574));await apply(await build(1,1),'cancel frozen loser');assert.deepEqual(v.state.subarray(790,1574),beforeCancel);
  await reject(binToHex(encodeTransaction(((await build(4,1)).builder as any).buildLibauthTransaction(true))),label+' rejects active refund');
  for(const delta of [-1n,1n])await reject(binToHex(encodeTransaction(((await build(3,0,owner,delta)).builder as any).buildLibauthTransaction(true))),label+' rejects incorrect sponsor fee '+delta);
  const settlement=await build(3,0),valid=settlement.builder.build(),decoded=decodeTransaction(hexToBin(valid));assert.notEqual(typeof decoded,'string');if(typeof decoded==='string')throw Error(decoded);
  // A separately funded, equivalent escrow cannot replace the canonical paired outpoint.
  const cs=(await import('../src/v2/protocol.js')).family(p,v.category,provider);
  for(const index of [1,2] as const){const asset=index===1?stakingAsset:rewardAsset,amount=index===1?remainingCommitment(v.state):rewardRemaining(v.state),donor=await funds(asset,amount),donorFee=await bch(10000n+BigInt(index)*1000n);
   const donation=new TransactionBuilder({provider}).addInput(donor,deposit.unlock.spend(owner)).addInput(donorFee,deposit.unlock.spend(owner));for(let i=0;i<index;i++)donation.addOutput({to:deposit.address,amount:1000n});donation.addOutput({to:index===1?cs.escrow.tokenAddress:cs.reserve.tokenAddress,...assetOutput(asset,amount)});
   const donated=await send(donation.build(),label+' noncanonical role '+index+' donation'),replacement=await out(donated,index),substituted=structuredClone(decoded),subSources=settlement.sources.map(sourceOutput);substituted.inputs[index]!.outpointTransactionHash=hexToBin(replacement.txid);substituted.inputs[index]!.outpointIndex=index;subSources[index]=sourceOutput(replacement);
   substituted.inputs[3]!.unlockingBytecode=deposit.unlock.spend(owner).generateUnlockingBytecode({transaction:substituted,sourceOutputs:subSources,inputIndex:3});
   await reject(binToHex(encodeTransaction(substituted)),label+' rejects equivalent noncanonical role '+index+' parent');
  }
  const mutate=async(name:string,change:(tx:Transaction)=>void)=>{const tx=structuredClone(decoded);change(tx);await reject(binToHex(encodeTransaction(tx)),label+' '+name);};
  await mutate('rejects diverted reward',tx=>{tx.outputs[3]!.valueSatoshis-=1n;});
  await mutate('rejects diverted escrow',tx=>{tx.outputs[1]!.valueSatoshis-=1n;});
  await mutate('rejects underfunded allocation',tx=>{tx.outputs[4]!.valueSatoshis-=1n;});
  await mutate('rejects state carrier theft',tx=>{tx.outputs[0]!.valueSatoshis-=1n;});
  await mutate('rejects swapped asset roles',tx=>{[tx.outputs[1],tx.outputs[2]]=[tx.outputs[2]!,tx.outputs[1]!];});
  await mutate('rejects wrong fee',tx=>{tx.outputs.push({valueSatoshis:1n,lockingBytecode:tx.outputs[3]!.lockingBytecode});});
  if(rewardAsset.kind==='token'){
   await mutate('rejects missing genuine reward',tx=>{delete tx.outputs[3]!.token;});
   await mutate('rejects unintended reward minting',tx=>{tx.outputs[3]!.token!.amount+=1n;});
   await mutate('rejects reward token burn',tx=>{tx.outputs[3]!.token!.amount-=1n;});
   await mutate('rejects wrong reward category',tx=>{tx.outputs[3]!.token!.category=hexToBin('ab'.repeat(32));});
  }
  if(stakingAsset.kind==='token')await mutate('rejects wrong stake category',tx=>{tx.outputs[4]!.token!.category=hexToBin('ab'.repeat(32));});
  const settled=await apply(settlement,'settle first');await reject(settled.raw,label+' rejects duplicate settlement');
  assert.equal(remainingCommitment(v.state),15000n+extraEscrow);assert.equal(rewardRemaining(v.state),p.cap*3n-terms.reward);
  await apply(await build(4,1),'refund cancelled remainder');assert.equal(remainingCommitment(v.state),6000n+extraEscrow);
  for(let i=1;i<3;i++){await apply(await build(2),'activate '+i);if(i===2)await apply(await build(1,0),'cancel activated winner for future periods');await apply(await build(3),'settle '+i);assert.equal(remainingCommitment(v.state),BigInt(2-i)*3000n+extraEscrow);assert.equal(rewardRemaining(v.state),p.cap*3n-BigInt(i+1)*terms.reward);}
  assert.equal(allocations.length,3);assert.equal(new Set(allocations.map(a=>a.input.txid)).size,3);
  for(let i=0;i<3;i++){
   const allocation=allocations[i]!;assert.equal(allocation.terms.readUInt32LE(74),p.epoch+(i+2)*10);
   const sponsor=unlock(await bch(10000n)),wb=withdrawalBuilder(allocation.input,allocation.terms,owner,sponsor,provider),bad=withdrawalBuilder(allocation.input,allocation.terms,other,sponsor,provider);
   await reject(binToHex(encodeTransaction((bad as any).buildLibauthTransaction(true))),label+' rejects invalid withdrawal signature');
   const raw=wb.build();
   assert.throws(()=>validateBuilt(raw,[allocation.input,sponsor.input],{height:1,mtp:allocation.terms.readUInt32LE(74)}),/not final/);
   validateBuilt(raw,[allocation.input,sponsor.input],{height:1,mtp:allocation.terms.readUInt32LE(74)+1});
   await reject(binToHex(encodeTransaction((wb.setLocktime(allocation.terms.readUInt32LE(74)-1) as any).buildLibauthTransaction(true))),label+' rejects early maturity');
   const id=await send(raw,label+' independent withdrawal '+i);await reject(raw,label+' duplicate withdrawal');
   if(i===2){const confirmed=await rpc('getrawtransaction',[id,true]);try {await rpc('invalidateblock',[confirmed.blockhash]);assert.ok(await rpc('gettxout',[allocation.input.txid,4,false]));}finally{await rpc('reconsiderblock',[confirmed.blockhash]);}assert.ok((await rpc('getrawtransaction',[id,true])).confirmations>0);evidence.push({label:label+' withdrawal reorganization restored',block:confirmed.blockhash});}

  }
  evidence.push({label,finalEscrow:remainingCommitment(v.state).toString(),finalRewards:rewardRemaining(v.state).toString(),allocations:allocations.map(a=>({outpoint:a.input.txid+':4',maturity:a.terms.readUInt32LE(74)}))});
 }
 assert.throws(()=>initialState({version:2,stakingAsset:native,rewardAsset:native,epoch:1700000000,periodSeconds:10,periods:3,cap:999n}),/Invalid/);
 await writeFile('docs/generalized-assets-v2-results.json',JSON.stringify({verifiedAt:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,network:'regtest',publicWalletVerified:false,evidence},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
});
