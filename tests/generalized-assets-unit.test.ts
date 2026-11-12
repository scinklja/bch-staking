import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,advance,validateParameters,validateTerms,assetId,assetOutput,matches,exactPriority,rewardRemaining,type Parameters} from '../src/v2/protocol.js';
import {hashState,offer,remainingCommitment} from '../src/registry.js';
import {rankings} from '../src/arena-core.js';
import {SignatureTemplate} from 'cashscript';
const token={kind:'token' as const,category:'ab'.repeat(32)},bch={kind:'bch' as const};
const config:Parameters={version:2,stakingAsset:bch,rewardAsset:token,epoch:1800000000,periodSeconds:86400,periods:3,cap:10n};
test('v2 raw integer bounds, exact ranking, frozen roster and conservation',()=>{
 const p=validateParameters(config),key=new SignatureTemplate(new Uint8Array(32).fill(60)).publicKey;
 let state=initialState(p);assert.equal(state.length,1578);assert.equal(rewardRemaining(state),30n);
 state=advance(state,0,0,offer(key,3000,2,7,3));state=advance(state,0,1,offer(key,6000,1,7,3));
 assert.equal(remainingCommitment(state),27000n);assert.deepEqual(rankings(state).map(r=>r.slot),[0,1]);
 state=advance(state,2);const snapshot=state.subarray(790,1574).toString('hex');state=advance(state,1,0);
 assert.equal(state.subarray(790,1574).toString('hex'),snapshot);assert.equal(rankings(state)[0]!.slot,0);
 const settled=advance(state,3,0);assert.equal(rewardRemaining(settled),23n);assert.equal(remainingCommitment(settled),24000n);assert.notEqual(hashState(state),hashState(settled));
 const refund=advance(settled,4,0);assert.equal(remainingCommitment(refund),18000n);assert.equal(rewardRemaining(refund),23n);
 assert.deepEqual(exactPriority({stake:1000000n,duration:16,reward:999983n,maxWins:16}),{numerator:16000000n,denominator:999983n});
 assert.throws(()=>validateTerms(p,{stake:999n,duration:1,reward:7n,maxWins:1}));assert.throws(()=>validateTerms(p,{stake:1000n,duration:1,reward:11n,maxWins:1}));
 for(const value of [0,17,1.5,NaN])assert.throws(()=>validateParameters({...p,periods:value}));
 assert.throws(()=>validateParameters({...p,cap:10 as any}));assert.throws(()=>validateParameters({...p,epoch:2147483640}));
 assert.throws(()=>assetId({kind:'token',category:'00'.repeat(32)}));
});
test('same-category asset roles retain independent native and token amounts',()=>{
 for(const asset of [token,bch]){assert.deepEqual(assetOutput(asset,9000n),asset.kind==='bch'?{amount:10000n}:{amount:1000n,token:{category:token.category,amount:9000n}});
 const o=assetOutput(asset,9000n),u={txid:'12'.repeat(32),vout:1,lockingBytecode:'51',satoshis:o.amount,token:o.token};assert.equal(matches(u,asset,9000n),true);assert.equal(matches({...u,satoshis:u.satoshis-1n},asset,9000n),false);assert.equal(matches({...u,token:{category:token.category,amount:9000n,nft:{capability:'none' as const,commitment:''}}},asset,9000n),false);}
 assert.deepEqual(assetOutput(token,0n),{amount:1000n});assert.throws(()=>assetOutput(bch,-1n));
});
