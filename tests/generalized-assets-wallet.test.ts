import test from 'node:test';
import type {Transaction} from '@bitauth/libauth';
import assert from 'node:assert/strict';
import {WalletFixture} from './fixtures/wallet-chain.js';
import {AssetWallet,validateFundingPlan,type Operation,type Store} from '../src/v2/wallet.js';
import {AssetKeeper} from '../src/v2/keeper.js';
import {AssetIndexer} from '../src/v2/indexer.js';
import type {Asset,Parameters} from '../src/v2/protocol.js';
import {validateWalletSigned} from '../src/transactions-core.js';

test('v2 WizardConnect templates: all four pairs, same-category, durable approvals and withdrawals',async()=>{
 const native:Asset={kind:'bch'};
 for(const pair of ['tb','bt','tt','bb','same']){
 const f=new WalletFixture(),journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},asset:Asset={kind:'token',category:f.asset},other:Asset={kind:'token',category:f.other};
 let engine=new AssetWallet(f.chain.provider(),store);
 const stakingAsset=pair[0]==='b'?native:asset,rewardAsset=pair==='same'?asset:pair[1]==='b'?native:other;
 const p:Parameters={version:2,stakingAsset,rewardAsset,cap:rewardAsset.kind==='bch'?2000n:10n,periods:2,epoch:f.chain.clock().mtp-10000,periodSeconds:10};
 async function finish(op:Operation){assert.equal(op.stage,'review');assert.equal(op.plan!.fee,'10000');
  const raw=f.sign(op.plan!);validateWalletSigned(op.plan!,raw,f.chain.clock());assert.throws(()=>validateWalletSigned(op.plan!,f.sign(op.plan!,0x41),f.chain.clock()),/0x61|ALL/);
  op=await engine.submit(op.id,raw);assert.equal(op.stage,'pending');assert.equal(journal.get(op.id)!.raw,raw);f.chain.mine();
  engine=new AssetWallet(f.chain.provider(),store);op=await engine.resume(op.id);assert.equal(op.step,'action');assert.equal(op.stage,'review');
  op=await engine.submit(op.id,f.sign(op.plan!));assert.equal(op.stage,'pending');f.chain.mine();op=await engine.resume(op.id);assert.equal(op.step,'complete');return op;
 }
 const draft=await engine.create(p,f.keys);validateFundingPlan(draft,engine.provider);
 const changed=structuredClone(draft);(changed.plan!.request.transaction as Transaction).outputs.at(-1)!.lockingBytecode=new Uint8Array([0x51]);assert.throws(()=>validateFundingPlan(changed,engine.provider),/diverts/);
 if(rewardAsset.kind==='token'){const burn=structuredClone(draft);(burn.plan!.request.transaction as Transaction).outputs[1]!.token!.amount--;assert.throws(()=>validateFundingPlan(burn,engine.provider),/conserve|reserve/);const nft=structuredClone(draft);const token=nft.plan!.request.sourceOutputs.find(o=>o.token)!.token!;token.nft={capability:'none',commitment:new Uint8Array()};assert.throws(()=>validateFundingPlan(nft,engine.provider),/NFTs/);}
 const created=await finish(draft),config=created.config!;assert.ok(config.genesis);
 const t={stake:1000n,duration:1,reward:rewardAsset.kind==='bch'?1000n:7n,maxWins:2};await finish(await engine.offer(config,t,f.keys));
 const keeper=new AssetKeeper(new AssetIndexer(engine.provider,config),(c,action,slot)=>engine.action(c,action,slot,f.keys));
 assert.equal((await keeper.inspect()).phase,'sponsorship-required');await finish(await keeper.process());await finish(await keeper.process());
 const snapshot=await new AssetIndexer(engine.provider,config).sync();assert.equal(snapshot.allocations.length,1);assert.equal(snapshot.pending.length,0);assert.equal(snapshot.allocations[0]!.mature,true);
 await finish(await keeper.process());const activated=await new AssetIndexer(engine.provider,config).sync();assert.equal(activated.instance.state[4],1);
 await assert.rejects(()=>engine.offer(config,t,f.keys),/closed/);
 await finish(await engine.withdraw(config,snapshot.allocations[0]!.id,f.keys));const withdrawn=await new AssetIndexer(engine.provider,config).sync();assert.ok(withdrawn.allocations[0]!.withdrawal);assert.equal(withdrawn.instance.inputs[0].txid,activated.instance.inputs[0].txid);assert.equal(withdrawn.instance.state[4],1);
 f.chain.reorgLastBlock();const removed=[...journal.values()].find(o=>o.kind==='withdraw')!;const reconciled=await engine.resume(removed.id);assert.equal(reconciled.step,'action');assert.equal(reconciled.stage,'prepared');assert.equal(reconciled.raw,removed.raw);
 // Unrelated categories and NFTs survive every preparation, including same-category staking/reward.
 const inventory=await (await import('../src/electrum-wallet.js')).scanWallet(engine.provider,f.keys);assert.ok(inventory.coins.some(c=>c.utxo.token?.nft?.commitment==='12'));
 }
});

test('v2 wallet persists before broadcast and retains signed bytes after lost acknowledgement',async()=>{
 const f=new WalletFixture(),journal=new Map<string,Operation>(),store:Store={list:async()=>[...journal.values()],save:async op=>{journal.set(op.id,op);}},p:Parameters={version:2,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},cap:2000n,periods:2,epoch:f.chain.clock().mtp-1000,periodSeconds:10};
 let engine=new AssetWallet(f.chain.provider(),store),op=await engine.create(p,f.keys),raw=f.sign(op.plan!);
 const broken=new AssetWallet(f.chain.provider(),{list:store.list,save:async()=>{throw Error('Disk quota');}});await assert.rejects(()=>broken.submit(op.id,raw),/quota/);assert.equal(f.chain.broadcasts.length,0);
 f.chain.loseAcknowledgement=true;op=await engine.submit(op.id,raw);assert.equal(op.stage,'prepared');assert.equal(op.raw,raw);f.chain.mine();engine=new AssetWallet(f.chain.provider(),store);op=await engine.resume(op.id);assert.equal(op.stage,'review');assert.equal(op.step,'action');assert.equal(f.chain.broadcasts.length,1);
 const old=f.sign(op.plan!);const again=await engine.resume(op.id);assert.equal(again.stage,'review');validateWalletSigned(again.plan!,old,f.chain.clock());
});

test('v2 competing registrations refresh unsigned slots and preserve prepared funds',async()=>{
 const f=new WalletFixture(),journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async o=>{journal.set(o.id,structuredClone(o));}},engine=new AssetWallet(f.chain.provider(),store),p:Parameters={version:2,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},cap:2000n,periods:2,epoch:f.chain.clock().mtp-1000,periodSeconds:10};
 let created=await engine.create(p,f.keys);created=await engine.submit(created.id,f.sign(created.plan!));f.chain.mine();created=await engine.resume(created.id);created=await engine.submit(created.id,f.sign(created.plan!));f.chain.mine();created=await engine.resume(created.id);
 const terms={stake:1000n,duration:1,reward:1000n,maxWins:1};
 async function prepared(){let op=await engine.offer(created.config!,terms,f.keys);op=await engine.submit(op.id,f.sign(op.plan!));f.chain.mine();return engine.resume(op.id);}
 let one=await prepared(),two=await prepared();const stale=f.sign(two.plan!);one=await engine.submit(one.id,f.sign(one.plan!));f.chain.mine();
 await assert.rejects(()=>engine.submit(two.id,stale),/spent|pending|changed/);two=await engine.resume(two.id);assert.throws(()=>validateWalletSigned(two.plan!,stale,f.chain.clock()),/changed/);two=await engine.submit(two.id,f.sign(two.plan!));f.chain.mine();assert.equal((await engine.resume(two.id)).step,'complete');
 const snapshot=await new AssetIndexer(engine.provider,created.config!).sync();assert.equal(snapshot.instance.state[5],2);
});

test('v2 removed funding confirmations retain identical signed funding for explicit recovery',async()=>{
 const f=new WalletFixture(),journal=new Map<string,Operation>(),store:Store={list:async()=>[...journal.values()],save:async o=>{journal.set(o.id,o);}},engine=new AssetWallet(f.chain.provider(),store),p:Parameters={version:2,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},cap:2000n,periods:2,epoch:f.chain.clock().mtp-1000,periodSeconds:10};
 let op=await engine.create(p,f.keys),fundingRaw=f.sign(op.plan!);op=await engine.submit(op.id,fundingRaw);f.chain.mine();op=await engine.resume(op.id);assert.equal(op.fundingRaw,fundingRaw);await assert.rejects(()=>engine.discard(op.id),/funded factory/);
 f.chain.reorgLastBlock();await assert.rejects(()=>engine.resume(op.id));assert.equal(journal.get(op.id)!.fundingRaw,fundingRaw);
 op=await engine.rebroadcastFunding(op.id);assert.equal(op.stage,'pending');f.chain.mine();op=await engine.resume(op.id);assert.equal(op.step,'action');assert.equal(op.stage,'review');assert.equal(f.chain.broadcasts[0],f.chain.broadcasts[1]);
});
