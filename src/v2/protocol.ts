import {Buffer} from '../bytes.js';
import {Contract,Network,TransactionBuilder,type NetworkProvider,type SpendableUtxo,type SignatureTemplate,type Unlocker} from 'cashscript';
import {binToHex,encodeCashAddress,hash160} from '@bitauth/libauth';
import RegistryV2 from '../../artifacts/RegistryV2.json' with {type:'json'};
import RegistryGenesisV2 from '../../artifacts/RegistryGenesisV2.json' with {type:'json'};
import AssetRoleV2 from '../../artifacts/AssetRoleV2.json' with {type:'json'};
import StakeAllocationV2 from '../../artifacts/StakeAllocationV2.json' with {type:'json'};
import {allocationTerms,hashState,nextState,offer,periodBoundary,remainingCommitment,STATE_SIZE,uint} from '../registry.js';
import {records,rankings} from '../arena-core.js';
import {sourceOutput,validateKeeperTransaction,type KeeperClock,type Sponsor} from '../keeper-core.js';
export type Asset={kind:'bch'}|{kind:'token';category:string};
export interface Parameters {version:2;stakingAsset:Asset;rewardAsset:Asset;epoch:number;periodSeconds:number;periods:number;cap:bigint}
export interface Instance {parameters:Parameters;category:string;state:Buffer;inputs:[SpendableUtxo,SpendableUtxo,SpendableUtxo]}
export interface Terms {stake:bigint;duration:number;reward:bigint;maxWins:number}
export const ZERO='00'.repeat(32),FEE=10000n,CARRIER=1000n,V2_STATE_SIZE=STATE_SIZE+4;
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
export function initialState(p:Parameters){validateParameters(p);return Buffer.concat([Buffer.alloc(STATE_SIZE),uint(Number(p.cap*BigInt(p.periods)),4)]);}
export function rewardRemaining(state:Uint8Array){if(state.length!==V2_STATE_SIZE)throw Error('Invalid v2 state length');return BigInt(Buffer.from(state).readUInt32LE(STATE_SIZE));}
export function advance(state:Uint8Array,action:number,slot=0,record=new Uint8Array()) {
 const q=rewardRemaining(state),s=Buffer.from(state);
 const reward=action===3?BigInt(records(s,true)[slot]?.reward??0):0n;
 if(q<reward)throw Error('Reward reserve exhausted');
 return Buffer.concat([nextState(s.subarray(0,STATE_SIZE),action,slot,record),uint(Number(q-reward),4)]);
}
export function validateTerms(p:Parameters,t:Terms){
 if(typeof t.stake!=='bigint'||typeof t.reward!=='bigint'||t.stake<1000n||t.stake>1000000n||t.reward<(p.rewardAsset.kind==='bch'?1000n:1n)||t.reward>p.cap||!Number.isInteger(t.duration)||t.duration<1||t.duration>p.periods||!Number.isInteger(t.maxWins)||t.maxWins<1||t.maxWins>p.periods)throw Error('Invalid offer raw units or periods');
 return t.stake*BigInt(t.maxWins);
}
export function exactPriority(t:Terms){return {numerator:t.stake*BigInt(t.duration),denominator:t.reward};}
function network(p:NetworkProvider){if(p.network!==Network.REGTEST&&p.network!==Network.CHIPNET)throw Error('V2 is regtest/chipnet only');}
const artifacts={RegistryV2,RegistryGenesisV2,AssetRoleV2,StakeAllocationV2};
export function covenant(name:keyof typeof artifacts,args:(bigint|Uint8Array)[],provider:NetworkProvider){network(provider);return new Contract(artifacts[name],args,{provider,contractType:'p2sh32'});}
export function parameterArgs(p:Parameters){validateParameters(p);return [Buffer.concat([assetBytes(p.stakingAsset),assetBytes(p.rewardAsset)]),BigInt(p.epoch),BigInt(p.periodSeconds),BigInt(p.periods),p.cap];}
export function family(p:Parameters,category:string,provider:NetworkProvider){
 if(!/^[a-f0-9]{64}$/.test(category)||[assetId(p.stakingAsset),assetId(p.rewardAsset)].includes(category))throw Error('State/asset category collision');
 const c=Buffer.from(category,'hex').reverse();return {
 registry:covenant('RegistryV2',[c,...parameterArgs(p)],provider),
 escrow:covenant('AssetRoleV2',[Buffer.concat([c,assetBytes(p.stakingAsset),Buffer.from([1])])],provider),
 reserve:covenant('AssetRoleV2',[Buffer.concat([c,assetBytes(p.rewardAsset),Buffer.from([2])])],provider)};
}
/** Only exact fungible prefixes are accepted; token NFTs and unrelated tokens are never fees. */
export function assetOutput(asset:Asset,amount:bigint,base=CARRIER){
 assetId(asset);if(amount<0n)throw Error('Negative asset amount');
 return {amount:base+(asset.kind==='bch'?amount:0n),...(asset.kind==='token'&&amount>0n?{token:{category:asset.category,amount}}:{})};
}
export function matches(input:SpendableUtxo,asset:Asset,amount:bigint,base=CARRIER){const expected=assetOutput(asset,amount,base);return input.satoshis===expected.amount&&!input.token?.nft&&(expected.token?input.token?.category===expected.token.category&&input.token.amount===amount:!input.token);}
export function validateInstance(v:Instance,provider:NetworkProvider){
 validateParameters(v.parameters);const cs=family(v.parameters,v.category,provider),[s,e,r]=v.inputs;
 if(v.state.length!==V2_STATE_SIZE||s.satoshis!==CARRIER||s.lockingBytecode!==cs.registry.lockingBytecode||s.token?.category!==v.category||s.token.amount!==0n||s.token.nft?.capability!=='mutable'||s.token.nft.commitment!==hashState(v.state)||e.lockingBytecode!==cs.escrow.lockingBytecode||r.lockingBytecode!==cs.reserve.lockingBytecode||e.txid!==s.txid||r.txid!==s.txid||s.vout!==0||e.vout!==1||r.vout!==2||!matches(e,v.parameters.stakingAsset,remainingCommitment(v.state))||!matches(r,v.parameters.rewardAsset,rewardRemaining(v.state)))throw Error('V2 protected source mismatch');
 return cs;
}
export function ownerAddress(owner:Uint8Array,provider:NetworkProvider){const a=encodeCashAddress({prefix:provider.network===Network.REGTEST?'bchreg':'bchtest',type:'p2pkhWithTokens',payload:hash160(owner)});if(typeof a==='string')throw Error(a);return a.address;}
export function termsFor(v:Instance,slot:number){const r=records(v.state,true)[slot];if(!r)throw Error('Missing allocation winner');return allocationTerms(Buffer.from(r.owner,'hex'),v.category,assetId(v.parameters.stakingAsset),slot,v.state.readUInt32LE(0),r.stake,periodBoundary(v.parameters,v.state.readUInt32LE(0)+r.duration));}
export function stateOutput(category:string,state:Uint8Array){return {amount:CARRIER,token:{category,amount:0n,nft:{capability:'mutable' as const,commitment:hashState(state)}}};}
export function genesisBuilder(p:Parameters,factoryInput:SpendableUtxo,rewardFunding:Sponsor,provider:NetworkProvider){
 const factory=covenant('RegistryGenesisV2',parameterArgs(p),provider),cs=family(p,factoryInput.txid,provider),state=initialState(p);
 if(factoryInput.vout!==0||factoryInput.token||factoryInput.satoshis!==12000n||factoryInput.lockingBytecode!==factory.lockingBytecode||!matches(rewardFunding.input,p.rewardAsset,p.cap*BigInt(p.periods)))throw Error('Incorrect factory or exact full reward funding');
 const builder=new TransactionBuilder({provider}).addInput(factoryInput,factory.unlock.create()).addInput(rewardFunding.input,rewardFunding.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(factoryInput.txid,state)}).addOutput({to:cs.escrow.address,amount:CARRIER})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(p.rewardAsset,p.cap*BigInt(p.periods))});return {builder,state};
}
// A caller supplies either a wallet placeholder or an actual SignatureTemplate. No key is held here.
export function transitionBuilder(v:Instance,action:number,slot:number,provider:NetworkProvider,clock:KeeperClock,sponsor:Sponsor,authorization?:SignatureTemplate|Uint8Array,registration?:{owner:Uint8Array;terms:Terms;funding:Sponsor}) {
 const cs=validateInstance(v,provider),state=v.state;
 if(!Number.isInteger(action)||action<0||action>5||!Number.isInteger(slot)||slot<0||slot>15)throw Error('Invalid action or slot');
 if(sponsor.input.token)throw Error('Fee sponsor must be token-free BCH');
 let record=Buffer.alloc(0);
 if(action===0){if(!registration)throw Error('Missing registration');const n=validateTerms(v.parameters,registration.terms);if(!matches(registration.funding.input,v.parameters.stakingAsset,n,v.parameters.stakingAsset.kind==='bch'?0n:CARRIER))throw Error('Incorrect exact stake funding');record=offer(registration.owner,Number(registration.terms.stake),registration.terms.duration,Number(registration.terms.reward),registration.terms.maxWins);}
 const next=advance(state,action,slot,record),b=new TransactionBuilder({provider}).setLocktime(action===2?periodBoundary(v.parameters,state.readUInt32LE(0)):clock.mtp-1)
 .addInput(v.inputs[0],cs.registry.unlock.transition(state,BigInt(action),BigInt(slot),record,authorization??Buffer.alloc(0)))
 .addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend());
 if(action===0)b.addInput(registration!.funding.input,registration!.funding.unlocker);
 b.addInput(sponsor.input,sponsor.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,next)})
 .addOutput({to:cs.escrow.tokenAddress,...assetOutput(v.parameters.stakingAsset,remainingCommitment(next))})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(v.parameters.rewardAsset,rewardRemaining(next))});
 let terms:Buffer|undefined;
 if(action===3){const winner=records(state,true)[slot];if(!winner)throw Error('Missing winner');terms=termsFor(v,slot);const a=covenant('StakeAllocationV2',[terms],provider);
 b.addOutput({to:ownerAddress(Buffer.from(winner.owner,'hex'),provider),...assetOutput(v.parameters.rewardAsset,BigInt(winner.reward),v.parameters.rewardAsset.kind==='bch'?0n:CARRIER)})
 .addOutput({to:a.tokenAddress,...assetOutput(v.parameters.stakingAsset,BigInt(winner.stake),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 if(action===4){const r=records(state)[slot];if(!r)throw Error('Missing refund owner');b.addOutput({to:ownerAddress(Buffer.from(r.owner,'hex'),provider),...assetOutput(v.parameters.stakingAsset,BigInt(r.stake)*BigInt(r.maxWins-r.wins),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 return {builder:b,state:next,terms,sources:[...v.inputs,...(action===0?[registration!.funding.input]:[]),sponsor.input]};
}
export function sponsorAmount(v:Instance,action:number){return FEE+(action===0&&v.parameters.stakingAsset.kind==='token'?-CARRIER:0n)+(action===3?(v.parameters.rewardAsset.kind==='token'?CARRIER:0n)+(v.parameters.stakingAsset.kind==='token'?CARRIER:0n):0n)+(action===4&&v.parameters.stakingAsset.kind==='token'?CARRIER:0n);}
export function withdrawalBuilder(input:SpendableUtxo,terms:Buffer,owner:SignatureTemplate|Uint8Array,sponsor:Sponsor,provider:NetworkProvider){
 const asset:Asset=terms.subarray(78).toString('hex')===ZERO?{kind:'bch'}:{kind:'token',category:Buffer.from(terms.subarray(78)).reverse().toString('hex')},a=covenant('StakeAllocationV2',[terms],provider),amount=BigInt(terms.readUInt32LE(70));
 if(input.lockingBytecode!==a.lockingBytecode||!matches(input,asset,amount,asset.kind==='bch'?0n:CARRIER)||sponsor.input.token||sponsor.input.satoshis!==FEE)throw Error('Invalid withdrawal source or external fee');
 return new TransactionBuilder({provider}).setLocktime(terms.readUInt32LE(74)).addInput(input,a.unlock.withdraw(owner)).addInput(sponsor.input,sponsor.unlocker).addOutput({to:ownerAddress(terms.subarray(0,33),provider),...assetOutput(asset,amount,asset.kind==='bch'?0n:CARRIER)});
}
export function decision(v:Instance,clock:KeeperClock){const period=v.state.readUInt32LE(0);if(period>=v.parameters.periods)return {phase:'complete'} as const;if(!v.state[4]&&clock.mtp<=periodBoundary(v.parameters,period))return {phase:'waiting'} as const;const ranked=rankings(v.state,true);return {phase:'ready',action:v.state[4]?(ranked.length?3:5):2,slot:v.state[4]&&ranked.length?ranked[0]!.slot:0} as const;}
export function validateBuilt(raw:string,inputs:SpendableUtxo[],clock:KeeperClock){return validateKeeperTransaction(raw,inputs.map(sourceOutput),clock,FEE);}
