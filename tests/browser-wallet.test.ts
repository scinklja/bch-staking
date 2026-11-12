import test from 'node:test';
import assert from 'node:assert/strict';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {SignatureTemplate} from 'cashscript';
import {SettlementChain,settlementConfig} from './fixtures/settlement-chain.js';
import {BrowserWallet,type WalletOperation,type WalletOperationStore} from '../src/browser-wallet.js';
import {BrowserKeeper} from '../src/browser-keeper.js';
import {ElectrumIndexer} from '../src/indexer-core.js';
import {decodeRawTransaction} from '../src/electrum-core.js';
import {walletScript,validateWalletSigned,buildRegistration,type BrowserPlan,type WalletKey} from '../src/transactions-core.js';
import {vaultFunding,validateVaultParameters,validateOfferTerms} from '../src/wallet-terms.js';
import {WalletFixture} from './fixtures/wallet-chain.js';
test('browser wallet: two-step factory creation, exact reserve accounting, restart and canonical local import',async()=>{
 const f=new WalletFixture(),p=f.parameters(),quote=vaultFunding(p);assert.equal(quote.total,82000n);await f.engine.scan(f.keys);
 let op=await f.engine.create(p,f.keys);assert.equal(op.plan!.fee,'2000');assert.equal((op.plan!.request.transaction as Transaction).outputs[0].token,undefined);
 op=await f.engine.submit(op.id,f.sign(op.plan!),f.keys);assert.equal(op.stage,'pending');assert.ok(f.journal.get(op.id)!.raw);assert.equal((await f.engine.get(op.id)).stage,'pending');
 const pendingId=op.txid!;f.chain.mine();f.restart();op=await f.engine.advance(op.id,[]);assert.equal(op.pregenesis,pendingId);assert.equal(op.step,'genesis');assert.equal(op.stage,'pending');
 f.chain.mine();op=await f.engine.get(op.id);assert.equal(op.step,'complete');assert.equal(op.config!.genesis,op.genesis);const tx=f.chain.transactions.get(op.genesis!)!;assert.equal(tx.vout[0].satoshis,quote.reserve.toString());assert.equal(tx.vout[1].satoshis,'1000');assert.equal(tx.vout[0].tokenData!.category,pendingId);
 assert.equal((await f.engine.importVault(op.config!)).category,pendingId);assert.equal(f.chain.broadcasts.length,2);
});
test('browser wallet: token consolidation/change, 0x61 covenant authorization, canonical registration and subsequent browser settlement',async()=>{
 const f=new WalletFixture(),created=await f.created(),terms={stake:1000,duration:2,reward:1000,maxWins:2};await f.engine.scan(f.keys);
 let op=await f.engine.offer(created.config!,terms,f.keys);assert.equal(op.step,'preparation');assert.equal(op.coins.filter(c=>c.utxo.token).length,2);assert.ok(op.coins.every(c=>!c.utxo.token||c.utxo.token.category===f.asset&&!c.utxo.token.nft));
 const prep=f.sign(op.plan!);assert.throws(()=>validateWalletSigned(op.plan!,f.sign(op.plan!,0x41),f.chain.clock()),/0x61|ALL/);
 op=await f.engine.submit(op.id,prep,f.keys);const prepId=op.txid!;f.chain.mine();f.restart();op=await f.engine.advance(op.id,f.keys);assert.equal(op.stage,'review');assert.equal(op.step,'register');assert.deepEqual(op.plan!.inputPaths,[[0,'receive',0],[2,'receive',0]]);
 const signed=f.sign(op.plan!);validateWalletSigned(op.plan!,signed,f.chain.clock());op=await f.engine.submit(op.id,signed,f.keys);assert.equal(op.stage,'pending');f.chain.mine();op=await f.engine.get(op.id);assert.equal(op.step,'complete');
 const preparation=f.chain.transactions.get(prepId)!;assert.equal(preparation.vout[0].tokenData!.amount,'2000');assert.equal(preparation.vout[1].tokenData!.amount,'500');
 f.startSchedule();const index=new ElectrumIndexer([created.config!],f.chain.provider()),intents=new Map();const keeper=new BrowserKeeper(index,{load:async c=>intents.get(c),save:async i=>{intents.set(i.category,i);} },async(_c,work)=>{await work();return true;});
 for(let i=0;i<2;i++){await keeper.tick(true);assert.equal(keeper.statuses[created.pregenesis!]!.phase,'pending');f.chain.mine();await keeper.tick(false);}
 const vault=index.vaults[0]!;assert.equal(vault.allocations.length,1);assert.equal(vault.allocations[0].output.tokenData.amount,'1000');const settled=vault.transaction;assert.equal(settled.vout[2].satoshis,'1000');
 const inv=await f.engine.scan(f.keys);assert.equal(inv.coins.find(c=>c.utxo.token?.category===f.other)!.utxo.token!.amount,5000n);assert.ok(inv.coins.some(c=>c.utxo.token?.nft?.commitment==='12'));
});
test('browser wallet: validation, wrong asset/balance, unsigned mutation and failed persistence never broadcast',async()=>{
 const f=new WalletFixture();await f.engine.scan(f.keys);const p=f.parameters();
 for(const bad of [{...p,periods:17},{...p,cap:999},{...p,epoch:2147483640},{...p,periodSeconds:0},{...p,stakingCategory:'bad'}])assert.throws(()=>validateVaultParameters(bad));
 for(const bad of [{stake:999,duration:1,reward:1000,maxWins:1},{stake:1000,duration:3,reward:1000,maxWins:1},{stake:1000,duration:1,reward:2001,maxWins:1},{stake:1000,duration:1,reward:1000,maxWins:0}])assert.throws(()=>validateOfferTerms(p,bad));
 await assert.rejects(()=>f.engine.create({...p,stakingCategory:'ee'.repeat(32)},f.keys),/proven/);await assert.rejects(()=>f.engine.create({...p,cap:1000000},f.keys),/Insufficient BCH/);
 let op=await f.engine.create(p,f.keys);const altered=structuredClone(op.plan!.request.transaction) as Transaction;altered.outputs[0].valueSatoshis--;assert.throws(()=>validateWalletSigned(op.plan!,binToHex(encodeTransaction(altered)),f.chain.clock()),/changed/);
 const raw=f.sign(op.plan!);const failing=new BrowserWallet(f.engine.index,{list:()=>f.store.list(),save:async()=>{throw Error('disk quota');}});await assert.rejects(()=>failing.submit(op.id,raw,f.keys),/quota/);assert.equal(f.chain.broadcasts.length,0);
 f.chain.fail=true;await assert.rejects(()=>f.engine.submit(op.id,raw,f.keys),/disconnected/);f.chain.fail=false;assert.equal(f.chain.broadcasts.length,0);
});
test('browser wallet: missing acknowledgement, interrupted factory recovery, provider disagreement and reorgs fail closed',async()=>{
 const f=new WalletFixture();await f.engine.scan(f.keys);let op=await f.engine.create(f.parameters(),f.keys);f.chain.loseAcknowledgement=true;op=await f.engine.submit(op.id,f.sign(op.plan!),f.keys);assert.equal(op.stage,'error');f.restart();assert.equal((await f.engine.advance(op.id,f.keys)).stage,'pending');assert.equal(f.chain.broadcasts.length,1);
 f.chain.mine();const recovery=await f.engine.recover(op.parameters,op.txid!);op=await f.engine.advance(recovery.id,[]);assert.equal(op.step,'genesis');f.chain.mine();op=await f.engine.get(op.id);assert.equal(op.step,'complete');f.chain.reorgLastBlock();op=await f.engine.get(op.id);assert.equal(op.stage,'error');
 f.chain.disagree=true;await assert.rejects(()=>f.engine.scan(f.keys),/disagreement|confirmation/);
});
test('browser wallet: competing registrations require a newly approved canonical slot and preserve prepared funding',async()=>{
 const f=new WalletFixture(),created=await f.created(),terms={stake:1000,duration:1,reward:1000,maxWins:1};
 await f.engine.scan(f.keys);let one=await f.engine.offer(created.config!,terms,f.keys);one=await f.engine.submit(one.id,f.sign(one.plan!),f.keys);f.chain.mine();one=await f.engine.advance(one.id,f.keys);assert.equal(one.step,'register');
 await f.engine.scan(f.keys);let two=await f.engine.offer(created.config!,terms,f.keys);two=await f.engine.submit(two.id,f.sign(two.plan!),f.keys);f.chain.mine();two=await f.engine.advance(two.id,f.keys);assert.equal(two.step,'register');
 const stale=f.sign(two.plan!);one=await f.engine.submit(one.id,f.sign(one.plan!),f.keys);await assert.rejects(()=>f.engine.submit(two.id,stale,f.keys),/spent|pending|conflict/);f.chain.mine();
 two=await f.engine.advance(two.id,f.keys);assert.equal(two.stage,'review');assert.notEqual(binToHex((two.plan!.request.transaction as Transaction).inputs[0].outpointTransactionHash),binToHex((f.journal.get(one.id)!.plan!.request.transaction as Transaction).inputs[0].outpointTransactionHash));
 assert.throws(()=>validateWalletSigned(two.plan!,stale,f.chain.clock()),/changed/);two=await f.engine.submit(two.id,f.sign(two.plan!),f.keys);f.chain.mine();two=await f.engine.get(two.id);assert.equal(two.step,'complete');
 const vault=f.engine.index.vaults.find(v=>v.config.genesis===created.config!.genesis)!;assert.deepEqual(vault.history.filter(h=>h.action===0).map(h=>h.slot),[0,1]);
});
test('browser wallet: resume refreshes before approval, activated/completed vaults refuse registration, prepared funds stay recoverable',async()=>{
 const f=new WalletFixture(),created=await f.created(),terms={stake:1000,duration:1,reward:1000,maxWins:1};await f.engine.scan(f.keys);let op=await f.engine.offer(created.config!,terms,f.keys);op=await f.engine.submit(op.id,f.sign(op.plan!),f.keys);f.chain.mine();op=await f.engine.advance(op.id,f.keys);assert.equal(op.stage,'review');const stale=f.sign(op.plan!);
 f.startSchedule();const index=new ElectrumIndexer([created.config!],f.chain.provider()),intents=new Map();const keeper=new BrowserKeeper(index,{load:async c=>intents.get(c),save:async i=>{intents.set(i.category,i);}},async(_c,work)=>{await work();return true;});
 await keeper.tick(true);f.chain.mine();await keeper.tick(false);const before=f.chain.broadcasts.length;await assert.rejects(()=>f.engine.advance(op.id,f.keys),/closed/);assert.equal(f.chain.broadcasts.length,before);await f.engine.scan(f.keys);assert.ok(f.engine.inventory!.coins.some(c=>c.utxo.txid===op.preparation&&c.utxo.vout===0));
 await keeper.tick(true);f.chain.mine();await keeper.tick(false);await assert.rejects(()=>f.engine.advance(op.id,f.keys),/closed/);
 for(let i=0;i<2;i++){await keeper.tick(true);f.chain.mine();await keeper.tick(false);}
 await f.engine.scan(f.keys);await assert.rejects(()=>f.engine.offer(created.config!,terms,f.keys),/closed/);
});

test('browser wallet: exact REGISTER commitment/carrier and closed/capacity constraints reject before requesting signatures',async()=>{
 const f=new WalletFixture(),created=await f.created(),terms={stake:1000,duration:1,reward:1000,maxWins:2};await f.engine.scan(f.keys);let op=await f.engine.offer(created.config!,terms,f.keys);op=await f.engine.submit(op.id,f.sign(op.plan!),f.keys);f.chain.mine();op=await f.engine.advance(op.id,f.keys);
 const vault=f.engine.index.vaults.find(v=>v.config.genesis===created.config!.genesis)!,coin=op.coins[0],owner=op.owner!,p=f.engine.provider;
 for(const amount of [1999n,2001n])await assert.rejects(()=>buildRegistration(vault,{...coin,utxo:{...coin.utxo,token:{...coin.utxo.token!,amount}}},owner,terms,p,f.chain.clock()),/exactly/);
 for(const satoshis of [9999n,10001n])await assert.rejects(()=>buildRegistration(vault,{...coin,utxo:{...coin.utxo,satoshis}},owner,terms,p,f.chain.clock()),/exactly/);
 for(const [offset,value] of [[4,1],[5,16],[0,2]]){const witness=Buffer.from(vault.witness,'hex');witness[offset]=value;await assert.rejects(()=>buildRegistration({...vault,witness:witness.toString('hex')},coin,owner,terms,p,f.chain.clock()),/closed/);}
});
