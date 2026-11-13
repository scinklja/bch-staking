import {ZERO,FEE,CARRIER,assetId,assetBytes,validateParameters,validateTerms,decision,initialState,rewardRemaining,advance,allocationSequence,V3_STATE_SIZE,type Asset,type Parameters,type Terms} from './model.js';
export * from './model.js';
import {Buffer} from '../bytes.js';
import {Contract,Network,TransactionBuilder,type NetworkProvider,type SpendableUtxo,type SignatureTemplate,type Unlocker} from 'cashscript';
import {binToHex,encodeCashAddress,hash160,decodeTransaction,hexToBin,createVirtualMachineBch2026,hashTransaction} from '@bitauth/libauth';
import FeeSponsorV3 from '../../artifacts/FeeSponsorV3.json' with {type:'json'};
import RegistryV3 from '../../artifacts/RegistryV3.json' with {type:'json'};
import RegistryGenesisV3 from '../../artifacts/RegistryGenesisV3.json' with {type:'json'};
import AssetRoleV3 from '../../artifacts/AssetRoleV3.json' with {type:'json'};
import StakeAllocationV3 from '../../artifacts/StakeAllocationV3.json' with {type:'json'};
import {allocationTerms,hashState,offer,remainingCommitment} from '../registry.js';
import {records} from '../arena-core.js';
import {sourceOutput,type KeeperClock,type Sponsor} from '../keeper-core.js';
export interface Instance {parameters:Parameters;category:string;state:Buffer;inputs:[SpendableUtxo,SpendableUtxo,SpendableUtxo]}
import {v3Network as network} from './network.js';
const artifacts={FeeSponsorV3,RegistryV3,RegistryGenesisV3,AssetRoleV3,StakeAllocationV3};
export function covenant(name:keyof typeof artifacts,args:(bigint|Uint8Array)[],provider:NetworkProvider){network(provider);return new Contract(artifacts[name],args,{provider,contractType:'p2sh32'});}
export function parameterArgs(p:Parameters){validateParameters(p);return [Buffer.concat([assetBytes(p.stakingAsset),assetBytes(p.rewardAsset)]),BigInt(p.epoch),BigInt(p.periodSeconds),BigInt(p.periods),p.cap];}
export function family(p:Parameters,category:string,provider:NetworkProvider){
 if(!/^[a-f0-9]{64}$/.test(category)||[assetId(p.stakingAsset),assetId(p.rewardAsset)].includes(category))throw Error('State/asset category collision');
 const c=Buffer.from(category,'hex').reverse();return {
 registry:covenant('RegistryV3',[c,...parameterArgs(p)],provider),
 escrow:covenant('AssetRoleV3',[Buffer.concat([c,assetBytes(p.stakingAsset),Buffer.from([1])])],provider),
 reserve:covenant('AssetRoleV3',[Buffer.concat([c,assetBytes(p.rewardAsset),Buffer.from([2])])],provider)};
}
/** Only exact fungible prefixes are accepted; token NFTs and unrelated tokens are never fees. */
export function assetOutput(asset:Asset,amount:bigint,base=CARRIER){
 assetId(asset);if(amount<0n)throw Error('Negative asset amount');
 return {amount:base+(asset.kind==='bch'?amount:0n),...(asset.kind==='token'&&amount>0n?{token:{category:asset.category,amount}}:{})};
}
export function matches(input:SpendableUtxo,asset:Asset,amount:bigint,base=CARRIER){const expected=assetOutput(asset,amount,base);return input.satoshis===expected.amount&&!input.token?.nft&&(expected.token?input.token?.category===expected.token.category&&input.token.amount===amount:!input.token);}
export function validateInstance(v:Instance,provider:NetworkProvider){
 validateParameters(v.parameters);const cs=family(v.parameters,v.category,provider),[s,e,r]=v.inputs;
 if(v.state.length!==V3_STATE_SIZE||s.satoshis!==CARRIER||s.lockingBytecode!==cs.registry.lockingBytecode||s.token?.category!==v.category||s.token.amount!==0n||s.token.nft?.capability!=='mutable'||s.token.nft.commitment!==hashState(v.state)||e.lockingBytecode!==cs.escrow.lockingBytecode||r.lockingBytecode!==cs.reserve.lockingBytecode||e.txid!==s.txid||r.txid!==s.txid||s.vout!==0||e.vout!==1||r.vout!==2||!matches(e,v.parameters.stakingAsset,remainingCommitment(v.state))||!matches(r,v.parameters.rewardAsset,rewardRemaining(v.state)))throw Error('V3 protected source mismatch');
 return cs;
}
export function ownerAddress(owner:Uint8Array,provider:NetworkProvider){network(provider);const a=encodeCashAddress({prefix:provider.network===Network.REGTEST?'bchreg':'bchtest',type:'p2pkhWithTokens',payload:hash160(owner)});if(typeof a==='string')throw Error(a);return a.address;}
export function termsFor(v:Instance,slot:number){const r=records(v.state,false)[slot];if(!r)throw Error('Missing allocation winner');return allocationTerms(Buffer.from(r.owner,'hex'),v.category,assetId(v.parameters.stakingAsset),slot,r.wins,r.stake,allocationSequence(r.duration));}
export function stateOutput(category:string,state:Uint8Array){return {amount:CARRIER,token:{category,amount:0n,nft:{capability:'mutable' as const,commitment:hashState(state)}}};}
export function genesisBuilder(p:Parameters,factoryInput:SpendableUtxo,rewardFunding:Sponsor,provider:NetworkProvider){
 const factory=covenant('RegistryGenesisV3',parameterArgs(p),provider),cs=family(p,factoryInput.txid,provider),state=initialState(p);
 if(factoryInput.vout!==0||factoryInput.token||factoryInput.satoshis!==12000n||factoryInput.lockingBytecode!==factory.lockingBytecode||!matches(rewardFunding.input,p.rewardAsset,p.cap*BigInt(p.periods)))throw Error('Incorrect factory or exact full reward funding');
 const builder=new TransactionBuilder({provider}).addInput(factoryInput,factory.unlock.create()).addInput(rewardFunding.input,rewardFunding.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(factoryInput.txid,state)}).addOutput({to:cs.escrow.address,amount:CARRIER})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(p.rewardAsset,p.cap*BigInt(p.periods))});return {builder,state};
}
// A caller supplies either a wallet placeholder or an actual SignatureTemplate. No key is held here.
export function transitionBuilder(v:Instance,action:number,slot:number,provider:NetworkProvider,clock:KeeperClock,sponsor:Sponsor,authorization?:SignatureTemplate|Uint8Array,registration?:{owner:Uint8Array;terms:Terms;funding:Sponsor},payerChange?:{address:string}) {
 const cs=validateInstance(v,provider),state=v.state;
 if(!Number.isInteger(action)||action<0||action>4||action===2||!Number.isInteger(slot)||slot<0||slot>15)throw Error('Invalid action or slot');
 if(sponsor.input.token)throw Error('Fee sponsor must be token-free BCH');
 let record=Buffer.alloc(0);
 if(action===0){if(!registration)throw Error('Missing registration');const n=validateTerms(v.parameters,registration.terms,rewardRemaining(state));if(!matches(registration.funding.input,v.parameters.stakingAsset,n,v.parameters.stakingAsset.kind==='bch'?0n:CARRIER))throw Error('Incorrect exact stake funding');record=offer(registration.owner,Number(registration.terms.stake),registration.terms.duration,Number(registration.terms.reward),registration.terms.maxWins);}
 if(action===3){const d=decision(v,clock);if(d.phase!=='ready'||d.slot!==slot)throw Error(d.phase==='blocked'?d.reason:'Top offer changed');}
 const next=advance(state,action,slot,record),b=new TransactionBuilder({provider}).setLocktime(Math.max(500000000,clock.mtp-1))
 .addInput(v.inputs[0],cs.registry.unlock.transition(state,BigInt(action),BigInt(slot),record,authorization??Buffer.alloc(0)))
 .addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend());
 if(action===0)b.addInput(registration!.funding.input,registration!.funding.unlocker);
 b.addInput(sponsor.input,sponsor.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,next)})
 .addOutput({to:cs.escrow.tokenAddress,...assetOutput(v.parameters.stakingAsset,remainingCommitment(next))})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(v.parameters.rewardAsset,rewardRemaining(next))});
 let terms:Buffer|undefined;
 if(action===3){const winner=records(state,false)[slot];if(!winner)throw Error('Missing winner');terms=termsFor(v,slot);const a=covenant('StakeAllocationV3',[terms],provider);
 b.addOutput({to:ownerAddress(Buffer.from(winner.owner,'hex'),provider),...assetOutput(v.parameters.rewardAsset,BigInt(winner.reward),v.parameters.rewardAsset.kind==='bch'?0n:CARRIER)})
 .addOutput({to:a.tokenAddress,...assetOutput(v.parameters.stakingAsset,BigInt(winner.stake),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 if(action===4){const r=records(state)[slot];if(!r)throw Error('Missing refund owner');b.addOutput({to:ownerAddress(Buffer.from(r.owner,'hex'),provider),...assetOutput(v.parameters.stakingAsset,BigInt(r.stake)*BigInt(r.maxWins-r.wins),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 if(payerChange){
  if(action!==3)throw Error('Caller change is only supported for reward claims');
  const change=sponsor.input.satoshis-sponsorAmount(v,3);
  if(change<0n||change>0n&&change<CARRIER)throw Error('Insufficient BCH or claim change below 1000 satoshis');
  if(change>0n)b.addOutput({to:payerChange.address,amount:change});
 }
 return {builder:b,state:next,terms,sources:[...v.inputs,...(action===0?[registration!.funding.input]:[]),sponsor.input]};
}
export function sponsorAmount(v:Instance,action:number){return FEE+(action===0&&v.parameters.stakingAsset.kind==='token'?-CARRIER:0n)+(action===3?(v.parameters.rewardAsset.kind==='token'?CARRIER:0n)+(v.parameters.stakingAsset.kind==='token'?CARRIER:0n):0n)+(action===4&&v.parameters.stakingAsset.kind==='token'?CARRIER:0n);}
export function withdrawalBuilder(input:SpendableUtxo,terms:Buffer,owner:SignatureTemplate|Uint8Array,sponsor:Sponsor,provider:NetworkProvider){
 const asset:Asset=terms.subarray(78).toString('hex')===ZERO?{kind:'bch'}:{kind:'token',category:Buffer.from(terms.subarray(78)).reverse().toString('hex')},a=covenant('StakeAllocationV3',[terms],provider),amount=BigInt(terms.readUInt32LE(70));
 if(input.lockingBytecode!==a.lockingBytecode||!matches(input,asset,amount,asset.kind==='bch'?0n:CARRIER)||sponsor.input.token||sponsor.input.satoshis!==FEE)throw Error('Invalid withdrawal source or external fee');
 return new TransactionBuilder({provider}).addInput(input,a.unlock.withdraw(owner),{sequence:terms.readUInt32LE(74)}).addInput(sponsor.input,sponsor.unlocker).addOutput({to:ownerAddress(terms.subarray(0,33),provider),...assetOutput(asset,amount,asset.kind==='bch'?0n:CARRIER)});
}
/** Script and absolute finality validation. Relative input ages require chain context. */
export function validateBuilt(raw:string,inputs:SpendableUtxo[],clock:KeeperClock,sourceMtp?:number){
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed v3 transaction');
 if(tx.version!==2||tx.inputs.length!==inputs.length)throw Error('Invalid version or source count');
 if(tx.locktime>=(tx.locktime<500000000?clock.height+1:clock.mtp))throw Error('Transaction is not final');
 for(const [i,input] of tx.inputs.entries())if(input.sequenceNumber<0x80000000){
  if(i!==0||(input.sequenceNumber&0x400000)===0||sourceMtp===undefined)throw Error('Relative maturity requires verified source MTP');
  if(clock.mtp<sourceMtp+(input.sequenceNumber&65535)*512)throw Error('Allocation is not mature');
 }
 const sources=inputs.map(sourceOutput),fee=sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 if(fee!==FEE)throw Error('Incorrect external fee');
 const result=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:sources});if(result!==true)throw Error('V3 covenant validation failed: '+result);
 return {txid:hashTransaction(hexToBin(raw)),fee,transaction:tx};
}
