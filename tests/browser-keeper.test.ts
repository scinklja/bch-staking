import test from 'node:test';
import assert from 'node:assert/strict';
import { binToHex,decodeTransaction,encodeTransaction,hexToBin,encodeCashAddress,hash160 } from '@bitauth/libauth';
import { Network, TransactionBuilder } from 'cashscript';
import { BrowserKeeper,type SettlementIntent,type IntentStore } from '../src/browser-keeper.js';
import { ElectrumIndexer } from '../src/indexer-core.js';
import { buildKeeperTransition,keeperDecision,sourceOutput,validateKeeperTransaction } from '../src/keeper-core.js';
import { utxo,json,contracts,contract,rankings,termsFor } from '../src/arena-core.js';
import {nextState,hashState,remainingCommitment} from '../src/registry.js';
import { SettlementChain,settlementConfig } from './fixtures/settlement-chain.js';
const lock=async(_category:string,work:()=>Promise<void>)=>{await work();return true;};
function setup(chain=new SettlementChain()) {
 const journal=new Map<string,SettlementIntent>();let now=Date.now();
 const store:IntentStore={load:async id=>structuredClone(journal.get(id)),save:async intent=>{journal.set(intent.category,structuredClone(intent));}};
 const index=new ElectrumIndexer([settlementConfig],chain.provider()),keeper=new BrowserKeeper(index,store,lock,()=>now);
 return {chain,index,keeper,store,journal,setNow:(value:number)=>{now=value;},advance:()=>{now=Date.now();for(const [id,intent]of journal)journal.set(id,{...intent,nextRetryAt:0});}};
}
test('browser keeper: activation, canonical tied winner, payouts, allocations, reserve and sequential confirmations',async()=>{
 const f=setup();await f.keeper.tick(false);const v=f.index.vaults[0]!,category=v.category;
 assert.equal(f.keeper.statuses[category]!.phase,'activation-required');
 assert.equal(keeperDecision(v,{height:f.index.tip!.height,mtp:settlementConfig.epoch}).phase,'waiting');
 const confirmedSats:string[]=[];
 for(const action of [2,3,2,3]) {
  await f.keeper.tick(true);assert.equal(f.keeper.statuses[category]!.phase,'pending');
  const intent=f.journal.get(category)!;assert.equal(intent.action,action);if(action===3)assert.equal(intent.slot,0);
  const before=f.chain.broadcasts.length;await f.keeper.tick(true);assert.equal(f.chain.broadcasts.length,before,'pending transactions are never submitted repeatedly');
  f.chain.mine();await f.keeper.tick(true);assert.equal(f.keeper.statuses[category]!.phase,'confirmed');
  confirmedSats.push(f.index.vaults[0]!.transaction.vout[0].satoshis);
 }
 assert.deepEqual(confirmedSats,['50000','37000','27000','14000']);
 const final=f.index.vaults[0]!;assert.equal(final.allocations.length,2);assert.deepEqual(final.history.filter(h=>h.action===3).map(h=>h.slot),[0,0]);
 for(const a of final.allocations){assert.equal(a.output.satoshis,'2000');assert.equal(a.output.tokenData.amount,'2000');}
 assert.equal(f.chain.broadcasts.length,4);
});
test('local VM enforces winner, immediate reward and protected fee reserve; mainnet and non-final transactions rejected',async()=>{
 const f=setup();await f.keeper.tick(true);f.chain.mine();await f.keeper.tick(false);
 const v=f.index.vaults[0]!,p=f.index.electrum!,clock=f.chain.clock(),candidate=(await buildKeeperTransition(v,p,clock))!;
 const decoded=decodeTransaction(hexToBin(candidate.raw));assert.notEqual(typeof decoded,'string');if(typeof decoded==='string')return;
 assert.equal(decoded.outputs[2]!.valueSatoshis,1000n);assert.equal(decoded.outputs[3]!.token?.amount,2000n);
 const state=Buffer.from(v.witness,'hex'),next=nextState(state,3,1),cs=await contracts(v.config,v.category,p),loser=rankings(state,true)[1]!;
 const address=encodeCashAddress({prefix:'bchtest',type:'p2pkh',payload:hash160(Buffer.from(loser.owner,'hex'))});if(typeof address==='string')throw Error(address);
 const allocation=await contract('StakeAllocation',[termsFor(v.config,v.category,state,1)],p);
 const wrongWinner=new TransactionBuilder({provider:p}).setLocktime(clock.mtp-1)
  .addInput(utxo(v.transaction,0),cs.registry.unlock.transition(state,3n,1n,Buffer.alloc(0),Buffer.alloc(0)))
  .addInput(utxo(v.transaction,1),cs.pool.unlock.spend())
  .addOutput({to:cs.registry.tokenAddress,amount:37000n,token:{category:v.category,amount:0n,nft:{capability:'mutable',commitment:hashState(next)}}})
  .addOutput({to:cs.pool.tokenAddress,amount:1000n,token:{category:v.config.stakingCategory,amount:remainingCommitment(next)}})
  .addOutput({to:address.address,amount:1000n}).addOutput({to:allocation.tokenAddress,amount:2000n,token:{category:v.config.stakingCategory,amount:1000n}}).build();
 assert.throws(()=>validateKeeperTransaction(wrongWinner,candidate.sourceOutputs,clock,10000n),/validation/,'the covenant rejects the later tied registration even if a keeper proposes it');
 decoded.outputs[2]!.valueSatoshis=999n;assert.throws(()=>validateKeeperTransaction(binToHex(encodeTransaction(decoded)),candidate.sourceOutputs,clock),/validation/);
 const insufficient=structuredClone(v);insufficient.transaction.vout[0].satoshis='5000';
 await assert.rejects(buildKeeperTransition(insufficient,p,clock),/fee funding unavailable/);
 const nonfinal=decodeTransaction(hexToBin(candidate.raw));if(typeof nonfinal!=='string'){nonfinal.locktime=clock.mtp;assert.throws(()=>validateKeeperTransaction(binToHex(encodeTransaction(nonfinal)),candidate.sourceOutputs,clock),/not final/);}
 Reflect.set(p,'network',Network.MAINNET);await assert.rejects(buildKeeperTransition(v,p,clock),/chipnet\/regtest/);await assert.rejects(p.sendRawTransaction(candidate.raw),/chipnet/);
});
test('uncertain acknowledgements survive closure, do not duplicate submissions, and confirm after restart',async()=>{
 const f=setup();f.chain.loseAcknowledgement=true;await f.keeper.tick(true);const category=f.index.vaults[0]!.category;
 assert.equal(f.keeper.statuses[category]!.phase,'retrying');assert.equal(f.journal.get(category)!.phase,'uncertain');
 const restored=new BrowserKeeper(new ElectrumIndexer([settlementConfig],f.chain.provider()),f.store,lock);
 await restored.tick(true);assert.equal(restored.statuses[category]!.phase,'pending');assert.equal(f.chain.broadcasts.length,1);
 f.chain.mine();await restored.tick(true);assert.equal(restored.statuses[category]!.phase,'confirmed');
});
test('disconnects, provider disagreement, persistence failures and safety interlocks cannot send',async()=>{
 const f=setup();await f.keeper.tick(false);const category=f.index.vaults[0]!.category;
 f.chain.disagree=true;await f.keeper.tick(true);assert.match(f.keeper.statuses[category]!.message,/disagreement/);assert.equal(f.chain.broadcasts.length,0);
 f.chain.disagree=false;f.chain.fail=true;await assert.rejects(f.keeper.tick(true),/disconnected/);assert.equal(f.chain.broadcasts.length,0);
 f.chain.fail=false;f.keeper.canBroadcast=()=>false;await f.keeper.tick(true);assert.equal(f.chain.broadcasts.length,0);f.keeper.canBroadcast=undefined;f.advance();
 f.chain.fail=false;f.store.save=async()=>{throw Error('Storage quota failed');};await f.keeper.tick(true);assert.match(f.keeper.statuses[category]!.message,/Storage quota/);assert.equal(f.chain.broadcasts.length,0);
 const bad=f.journal.get(category)!;f.journal.set(category,{...bad,attempts:-1});await f.keeper.tick(true);assert.match(f.keeper.statuses[category]!.message,/Invalid settlement journal/);
 const g=setup(),request=g.chain.request;g.chain.request=async(method,...params)=>{if(method==='blockchain.transaction.broadcast')throw Error('min relay fee not met');return request(method,...params);};
 await g.keeper.tick(true);const status=g.keeper.statuses[g.index.vaults[0]!.category]!;assert.equal(status.phase,'blocked');assert.match(status.message,/external BCH fee sponsor/);
});
test('mempool rejection retries the identical transaction with backoff; a competing confirmed spend supersedes it',async()=>{
 const f=setup();f.chain.rejectNext=true;await f.keeper.tick(true);const category=f.index.vaults[0]!.category;
 assert.equal(f.keeper.statuses[category]!.phase,'retrying');const raw=f.journal.get(category)!.raw;
 await f.keeper.tick(true);assert.equal(f.chain.broadcasts.length,1);f.advance();await f.keeper.tick(true);assert.equal(f.journal.get(category)!.raw,raw);assert.equal(f.chain.broadcasts.length,2);
 const writes=f.chain.requestLog.filter(r=>r.method==='blockchain.transaction.broadcast');assert.notEqual(writes[0]!.endpoint,writes[1]!.endpoint,'a reconciled retry may change relay endpoint, never a mid-attempt retry');
 f.chain.mine();await f.keeper.tick(true);await f.keeper.tick(false); // activated, ready to settle
 f.chain.rejectNext=true;await f.keeper.tick(true);const intent=f.journal.get(category)!;
 const current=f.index.vaults[0]!,alternative=(await buildKeeperTransition(current,f.index.electrum!,{...f.chain.clock(),mtp:f.chain.clock().mtp-1}))!;
 await f.chain.request('blockchain.transaction.broadcast',alternative.raw);f.chain.mine();await f.keeper.tick(true);
 assert.equal(f.journal.get(category)!.phase,'superseded');assert.notEqual(intent.txid,alternative.txid);
});
test('independent keepers racing the same UTXOs rely on blockchain validation; reorganizations recover',async()=>{
 const f=setup(),other=new BrowserKeeper(new ElectrumIndexer([settlementConfig],f.chain.provider()),{load:async()=>undefined,save:async()=>{}},lock);
 await Promise.all([f.keeper.tick(true),other.tick(true)]);assert.equal(f.chain.pending.size,1);
 f.chain.mine();await f.keeper.tick(true);const category=f.index.vaults[0]!.category;assert.equal(f.keeper.statuses[category]!.phase,'confirmed');
 f.chain.reorgLastBlock();await f.keeper.tick(true);assert.equal(f.keeper.statuses[category]!.phase,'retrying');
 f.advance();await f.keeper.tick(true);assert.equal(f.chain.pending.size,1);f.chain.mine();await f.keeper.tick(true);assert.equal(f.index.vaults[0]!.history.filter(h=>h.action===2).length,1);
});

test('mandatory default starts without a control and cannot consume released reward reserves for miner fees',async()=>{
 const f=setup();await f.keeper.tick();assert.equal(f.chain.pending.size,1);f.chain.mine();await f.keeper.tick(false);
 const v=structuredClone(f.index.vaults[0]!);v.transaction.vout[0].satoshis='16000';
 await assert.rejects(buildKeeperTransition(v,f.index.electrum!,f.chain.clock()),/fee funding unavailable/);
});

test('verification becoming stale at the final broadcast boundary fails closed',async()=>{
 const f=setup();f.keeper.canBroadcast=()=>{f.setNow(Date.now()+61000);return true;};
 await f.keeper.tick();assert.equal(f.chain.broadcasts.length,0);assert.match(f.keeper.statuses[f.index.vaults[0]!.category]!.message,/became stale/);
});
