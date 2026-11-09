import type { Envelope, Offer } from '../src/model';
export const offers:Offer[]=[
  {slot:0,owner:'02'+'44'.repeat(32),stake:3000,duration:2,reward:1000,maxWins:3,wins:0,cancelled:false,refunded:false},
  {slot:1,owner:'03'+'55'.repeat(32),stake:6000,duration:2,reward:1000,maxWins:2,wins:0,cancelled:false,refunded:false},
];
export function witness(roster=offers,period=0,phase=0) {
  const bytes=new Uint8Array(1574),view=new DataView(bytes.buffer);view.setUint32(0,period,true);bytes[4]=phase;bytes[5]=roster.length;
  for(const start of [6,790]) for(const r of roster) {
    const p=start+r.slot*49;bytes.set(Uint8Array.from(r.owner.match(/../g)!,b=>parseInt(b,16)),p);
    view.setUint32(p+33,r.stake,true);view.setUint32(p+37,r.duration,true);view.setUint32(p+41,r.reward,true);
    bytes[p+45]=r.maxWins;bytes[p+46]=r.wins;bytes[p+47]=Number(r.cancelled);bytes[p+48]=Number(r.refunded);
  }
  return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function fixture():Envelope {
  const activation={txid:'c'.repeat(64),height:121,action:2,slot:0,period:0,witness:witness()};
  const settlement={txid:'d'.repeat(64),height:122,action:3,slot:1,period:0,witness:witness(offers,0,1)};
  return {chain:'regtest',confirmedOnly:true,tip:{height:125,hash:'f'.repeat(64),mtp:1794000090},health:{connected:true,error:'',updatedAt:new Date().toISOString()},vaults:[{
    category:'a'.repeat(64),config:{genesis:'b'.repeat(64),stakingCategory:'e'.repeat(64),epoch:1794000000,periodSeconds:60,periods:3,cap:1000},
    period:1,phase:'open',bchSatoshis:'90000',escrowTokens:'15000',stateOutpoint:'d'.repeat(64)+':0',poolOutpoint:'d'.repeat(64)+':1',witness:witness(offers,1),unsettledPeriods:[1,2],readyPeriods:[1],
    offers:offers.map(o=>({...o,wins:o.slot===1?1:0})),rankings:[{...offers[1],wins:1},offers[0]],snapshot:null,
    periods:[{period:0,boundary:1794000000,status:'settled',events:[activation,settlement]},{period:1,boundary:1794000060,status:'unsettled',events:[]},{period:2,boundary:1794000120,status:'unsettled',events:[]}],
    history:[activation,settlement],allocations:[{id:'d'.repeat(64)+':3',terms:'00'.repeat(110),owner:offers[1].owner,slot:1,period:0,stake:6000,maturity:1794000120,eligible:false,requiresOwnerSignature:true}],
    withdrawals:{commitments:offers.map(o=>({slot:o.slot,amount:(o.stake*o.maxWins).toString(),eligible:false,requiresOwnerSignature:true}))},
  }]};
}
