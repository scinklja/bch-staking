import { describe,expect,it } from 'vitest';
import { activationSnapshot,bch,envelopeSchema,ranked,score,staleReason,utc } from '../src/model';
import { fixture,offers,witness } from './fixture';
describe('protocol presentation',()=>{
  it('formats native BCH with exact eight decimals including values beyond floating point precision',()=>{
    expect(bch('1')).toBe('0.00000001');expect(bch('1000')).toBe('0.00001000');expect(bch('9007199254740993')).toBe('90071992.54740993');
  });
  it('uses reward satoshis in P, exact cross products, and canonical registration tie breaks',()=>{
    expect(score(offers[0])).toBe('6');
    const tied=[{...offers[0],slot:15},{...offers[0],slot:0},{...offers[1],slot:7,cancelled:true}];
    expect(ranked(tied).map(o=>o.slot)).toEqual([0,15]);
    expect(ranked(Array.from({length:16},(_,slot)=>({...offers[0],slot,stake:1000+slot})))[0].slot).toBe(15);
    expect(score({...offers[0],stake:1000,duration:1,reward:3000})).toBe('0.333333');
    expect(ranked([{...offers[0],wins:3},{...offers[1],refunded:true}])).toEqual([]);
  });
  it('reconstructs the full activation roster from the historical preimage rather than current offers',()=>{
    const data=fixture(),v=data.vaults[0];
    expect(v.offers[1].wins).toBe(1);
    expect(activationSnapshot(v.history[0])).toEqual(offers);
    const roster=Array.from({length:16},(_,slot)=>({...offers[0],slot}));
    expect(activationSnapshot({...v.history[0],witness:witness(roster)})).toEqual(roster);
  });
  it('validates the actual envelope contract and rejects non-regtest, malformed and unconfirmed payloads',()=>{
    const data=fixture();expect(envelopeSchema.safeParse(data).success).toBe(true);
    expect(envelopeSchema.safeParse({...data,chain:'main'}).success).toBe(false);
    expect(envelopeSchema.safeParse({...data,confirmedOnly:false}).success).toBe(false);
    data.vaults[0].history[0].witness='00';expect(envelopeSchema.safeParse(data).success).toBe(false);
  });
  it('detects lost connectivity, old successful responses and clock skew without using block age as sync health',()=>{
    const data=fixture(),now=Date.now();
    expect(staleReason(data,now,null)).toBeNull();
    expect(staleReason(data,now,'offline')).toMatch(/Refresh failed/);
    expect(staleReason({...data,health:{...data.health,connected:false}},now,null)).toMatch(/not synchronized/);
    expect(staleReason(data,now+31000,null)).toMatch(/stale/);
    expect(staleReason(data,now-31000,null)).toMatch(/clock/);
    expect(utc(1794000000)).toBe('2026-11-06 21:20:00 UTC');
  });
});
