import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,type Parameters,type Asset} from '../src/v3/protocol.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';
import {writeFile} from 'node:fs/promises';

test('caller-funded claims: four asset pairs, independent caller, change, signed-plan safety and durable recovery on BCHN',{timeout:600000},()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {
  loseAcknowledgement=false;broadcasts=0;
  override async sendRawTransaction(raw:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,true,JSON.stringify(a));this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Lost acknowledgement after acceptance');}return id;}
  override async tip(){return this.header(await rpc('getblockcount'));}
 }
 const provider=new Local(await rpc('getblockcount')),miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);provider.headerCache.clear();await provider.refresh();}
 const staker=new SignatureTemplate(new Uint8Array(32).fill(91)),caller=new SignatureTemplate(new Uint8Array(32).fill(92)),poor=new SignatureTemplate(new Uint8Array(32).fill(93));
 const keys=(key:SignatureTemplate):WalletKey[]=>[{publicKey:binToHex(key.publicKey),path:'receive',index:0}];
 const address=(key:SignatureTemplate)=>ownerAddress(key.publicKey,provider);
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},wallet=new AssetWallet(provider,store);
 await rpc('sendtoaddress',[address(staker),0.1]);await rpc('sendtoaddress',[address(caller),0.001]);await mine();
 function sign(plan:BrowserPlan,key:SignatureTemplate,mutate?:(tx:Transaction)=>void){const tx=structuredClone(plan.request.transaction) as Transaction;mutate?.(tx);
  for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i],preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i].unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function finish(op:Operation){await wallet.authorize(op.id);op=await wallet.submit(op.id,sign(op.plan!,staker));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);op=await wallet.submit(op.id,sign(op.plan!,staker));assert.equal(op.stage,'pending');await mine();return wallet.resume(op.id);}
 // Mint a genuine fungible asset to the staker, with an unrelated NFT at the caller.
 const funding=await rpc<string>('sendtoaddress',[address(staker),0.02]),fundTx=await rpc('getrawtransaction',[funding,true]);
 // The category genesis must spend output zero of its preparation transaction.
 const source=utxo(fundTx,fundTx.vout.findIndex((o:any)=>Math.round(o.value*1e8)===2000000));
 const pre=await new TransactionBuilder({provider}).addInput(source,staker.unlockP2PKH()).addOutput({to:address(staker),amount:1990000n}).build();
 const preId=await rpc<string>('sendrawtransaction',[pre]),mint=new TransactionBuilder({provider}).addInput(utxo(await rpc('getrawtransaction',[preId,true]),0),staker.unlockP2PKH()).addOutput({to:address(staker),amount:1979000n,token:{category:preId,amount:100000n}}).addOutput({to:address(caller),amount:1000n,token:{category:preId,amount:0n,nft:{capability:'none',commitment:'12'}}});
 const mintId=await rpc<string>('sendrawtransaction',[mint.build()]);await mine();
 const token:Asset={kind:'token',category:preId},bch:Asset={kind:'bch'},evidence=[];
 for(const [stakingAsset,rewardAsset] of [[bch,bch],[bch,token],[token,bch],[token,token]] as [Asset,Asset][]){
  const mtp=(await rpc('getblockchaininfo')).mediantime,p:Parameters={version:3,stakingAsset,rewardAsset,epoch:mtp-1000,periodSeconds:100,periods:4,cap:2000n};
  const created=await finish(await wallet.create(p,keys(staker))),config=created.config!;
  await finish(await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:2},keys(staker)));
  await assert.rejects(()=>wallet.claim(config,keys(poor)),/Insufficient BCH/);
  let op=await wallet.claim(config,keys(caller));assert.equal(op.kind,'claim');assert.equal(op.step,'action');assert.notEqual(op.owner.publicKey,keys(staker)[0]!.publicKey);assert.deepEqual(op.plan!.inputPaths,[[3,'receive',0]]);
  assert.equal(op.plan!.request.sourceOutputs[3]!.token,undefined);const tx=op.plan!.request.transaction as Transaction,required=10000n+(stakingAsset.kind==='token'?1000n:0n)+(rewardAsset.kind==='token'?1000n:0n);
  assert.equal(tx.inputs.length,4);assert.equal(tx.outputs.length,6);assert.equal(tx.outputs[5]!.valueSatoshis,op.plan!.request.sourceOutputs[3]!.valueSatoshis-required);assert.deepEqual(tx.outputs[5]!.lockingBytecode,op.plan!.request.sourceOutputs[3]!.lockingBytecode);assert.equal(tx.outputs[3]!.token?.amount??tx.outputs[3]!.valueSatoshis,2000n);
  const before=provider.broadcasts;await wallet.signingFailed(op.id,'User rejected signing');assert.match(journal.get(op.id)!.error!,/rejected/);assert.equal(provider.broadcasts,before);
  await wallet.authorize(op.id);
  for(const mutate of [(t:Transaction)=>{t.outputs[3]!.lockingBytecode=t.outputs[5]!.lockingBytecode;},(t:Transaction)=>{t.outputs[5]!.valueSatoshis--;},(t:Transaction)=>{t.outputs[5]!.lockingBytecode=t.outputs[3]!.lockingBytecode;}]){const bad=sign(op.plan!,caller,mutate);await assert.rejects(()=>wallet.submit(op.id,bad),/changed/);const [accept]=await rpc('testmempoolaccept',[[bad]]);assert.equal(accept.allowed,false,'Covenant must reject even a newly signed diversion');}
  // Persisted plan corruption must fail even before any signing request.
  const original=structuredClone(journal.get(op.id)!);journal.get(op.id)!.plan!.request.transaction.outputs[3]!.lockingBytecode=hexToBin('51');await assert.rejects(()=>wallet.authorize(op.id),/Saved claim/);journal.set(op.id,original);
  assert.equal(provider.broadcasts,before);
  const broken=new AssetWallet(provider,{list:store.list,save:async()=>{throw Error('Disk quota');}});await assert.rejects(()=>broken.submit(op.id,sign(op.plan!,caller)),/quota/);assert.equal(provider.broadcasts,before);
  provider.loseAcknowledgement=true;op=await wallet.submit(op.id,sign(op.plan!,caller));assert.equal(op.stage,'prepared');assert.ok(op.raw);assert.equal(provider.broadcasts,before+1);
  const restarted=new AssetWallet(provider,store);assert.equal((await restarted.resume(op.id)).stage,'pending');assert.equal(provider.broadcasts,before+1);await mine();op=await restarted.resume(op.id);assert.equal(op.stage,'confirmed');
  const snapshot=await new AssetIndexer(provider,config).sync();assert.equal(snapshot.allocations.length,1);assert.equal(snapshot.allocations[0]!.mature,false);assert.equal(snapshot.instance.state[52],1);
  const change=await rpc('gettxout',[op.txid,5]);assert.equal(BigInt(Math.round(change.value*1e8)),tx.outputs[5]!.valueSatoshis);
  if(stakingAsset.kind==='bch'&&rewardAsset.kind==='bch'){
   // Smallest exact-sized fee coin produces no change, without a preparation transaction.
   await rpc('sendtoaddress',[address(caller),0.0001]);await mine();
   const exact=await wallet.claim(config,keys(caller));assert.equal(exact.plan!.request.transaction.outputs.length,5);assert.equal(exact.plan!.request.sourceOutputs[3]!.valueSatoshis,10000n);
   const paid=await wallet.submit(exact.id,sign(exact.plan!,caller));assert.equal(paid.stage,'pending');await mine();assert.equal((await wallet.resume(paid.id)).stage,'confirmed');
  }
  evidence.push({staking:stakingAsset.kind,reward:rewardAsset.kind,txid:op.txid,inputs:4,outputs:6,minerFee:'10000',carriers:String(required-10000n),change:String(tx.outputs[5]!.valueSatoshis)});
 }
 assert.ok(await rpc('gettxout',[mintId,1]),'Caller NFT must remain unspent');
 await writeFile('docs/staking-arena-v3-caller-fee-results.json',JSON.stringify({network:'isolated BCHN regtest',verifiedAt:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,evidence,physicalCashonizeVerified:false},null,2)+'\n');
}));
