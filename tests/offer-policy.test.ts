import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledPolicy,assertOfferCutoff} from '../src/offer-policy.js';
import {WalletFixture} from './fixtures/wallet-chain.js';
import {BrowserWallet} from '../src/browser-wallet.js';
const config={stakingCategory:'a'.repeat(64),epoch:1800000000,periodSeconds:300,periods:2,cap:1000};
test('UTC cutoffs, future registration windows, chain lag, activation and lifetime expiry remain distinct',()=>{
 assert.equal(scheduledPolicy(config,0,false,config.epoch-1,config.epoch-600).offersAllowed,true);
 assert.throws(()=>assertOfferCutoff(config,0,false,0,config.epoch,config.epoch-600),/closed/);
 assert.equal(scheduledPolicy(config,0,false,config.epoch+1,config.epoch).status,'Overdue — awaiting activation');
 assert.equal(scheduledPolicy(config,0,true,config.epoch+1,config.epoch).status,'Activated — awaiting settlement');
 assert.equal(scheduledPolicy(config,1,false,config.epoch+100,config.epoch+1).status,'Open for offers');
 assert.equal(scheduledPolicy(config,0,false,config.epoch+600,config.epoch).status,'Expired — awaiting on-chain processing');
 assert.equal(scheduledPolicy(config,2,false,config.epoch+600,config.epoch).status,'Completed — all periods processed on-chain');
 assert.throws(()=>assertOfferCutoff(config,1,false,0,config.epoch-1,config.epoch+300),/closed/);
 assert.throws(()=>assertOfferCutoff(config,1,true,0,config.epoch+1,config.epoch),/closed/);
 assert.equal(scheduledPolicy(config,0,true,config.epoch+900,config.epoch).steps,3);
});
test('an offer prepared before the cutoff cannot be authorized or broadcast at the deadline',async()=>{
 const f=new WalletFixture();f.epoch=Math.floor(Date.now()/1000)+30;let now=Date.now();f.engine=new BrowserWallet(f.engine.index,f.store,()=>now);
 const created=await f.created(); // restart is not used here: the injected clock remains in effect.
 await f.engine.scan(f.keys);const op=await f.engine.offer(created.config!,{stake:1000,duration:1,reward:1000,maxWins:1},f.keys);
 await f.engine.authorize(op.id,f.keys);const before=f.chain.broadcasts.length;
 now=created.config!.epoch*1000;
 await assert.rejects(f.engine.authorize(op.id,f.keys),/Registration closed/);
 await assert.rejects(f.engine.submit(op.id,f.sign(op.plan!),f.keys),/Registration closed/);
 assert.equal(f.chain.broadcasts.length,before);
});
