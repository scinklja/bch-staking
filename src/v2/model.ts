import {Buffer} from '../bytes.js';
import {periodBoundary} from '../registry.js';
export type Asset={kind:'bch'}|{kind:'token';category:string};
export interface Parameters {version:2;stakingAsset:Asset;rewardAsset:Asset;epoch:number;periodSeconds:number;periods:number;cap:bigint}
export interface Terms {stake:bigint;duration:number;reward:bigint;maxWins:number}
export const ZERO='00'.repeat(32),FEE=10000n,CARRIER=1000n;
export function assetId(asset:Asset):string {
 if(asset.kind==='bch')return ZERO;
 if(asset.kind!=='token'||!/^[a-f0-9]{64}$/.test(asset.category)||asset.category===ZERO)throw Error('Invalid fungible asset category');
 return asset.category;
}
export function assetBytes(asset:Asset){return Buffer.from(assetId(asset),'hex').reverse();}
export function validateParameters(p:Parameters) {
 if(p.version!==2)throw Error('Unsupported covenant version');assetId(p.stakingAsset);assetId(p.rewardAsset);
 if(typeof p.cap!=='bigint'||p.cap<(p.rewardAsset.kind==='bch'?1000n:1n)||p.cap>1000000n||!Number.isInteger(p.periods)||p.periods<1||p.periods>16)throw Error('Invalid period count or raw reward cap');
 periodBoundary(p,2*p.periods-1);return p;
}
export function validateTerms(p:Parameters,t:Terms){
 if(typeof t.stake!=='bigint'||typeof t.reward!=='bigint'||t.stake<1000n||t.stake>1000000n||t.reward<(p.rewardAsset.kind==='bch'?1000n:1n)||t.reward>p.cap||!Number.isInteger(t.duration)||t.duration<1||t.duration>p.periods||!Number.isInteger(t.maxWins)||t.maxWins<1||t.maxWins>p.periods)throw Error('Invalid offer raw units or periods');
 return t.stake*BigInt(t.maxWins);
}
export function exactPriority(t:Terms){return {numerator:t.stake*BigInt(t.duration),denominator:t.reward};}

export function decision(v:{state:Uint8Array;parameters:Parameters},clock:{mtp:number}){
 const state=Buffer.from(v.state),period=state.readUInt32LE(0);if(period>=v.parameters.periods)return {phase:'complete'} as const;
 if(!state[4]&&clock.mtp<=periodBoundary(v.parameters,period))return {phase:'waiting'} as const;
 const eligible=[];for(let i=0;i<state[5]!;i++){const o=790+i*49;if(state[o+47]===0&&state[o+48]===0&&state[o+46]!<state[o+45]!)eligible.push({slot:i,stake:BigInt(state.readUInt32LE(o+33)),duration:BigInt(state.readUInt32LE(o+37)),reward:BigInt(state.readUInt32LE(o+41))});}
 eligible.sort((a,b)=>{const left=a.stake*a.duration*b.reward,right=b.stake*b.duration*a.reward;return left===right?a.slot-b.slot:left>right?-1:1;});
 return {phase:'ready',action:state[4]?(eligible.length?3:5):2,slot:state[4]&&eligible.length?eligible[0]!.slot:0} as const;
}
