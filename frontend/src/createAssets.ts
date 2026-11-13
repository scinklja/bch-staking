import {assetId,validateParameters,type Asset,type Parameters,CARRIER,FEE} from '../../src/v2/model';
import {bch} from './model';
import {rewardSatoshis,integer} from './marketplace';
import {validateVaultParameters,vaultFunding} from '../../src/wallet-terms';
export type AssetKind=Asset['kind'];
export const assetAmount=(asset:Asset,raw:bigint)=>asset.kind==='bch'?`${bch(raw)} BCH (${raw} satoshis)`:`${raw} raw fungible units`;
export const assetInputUnits=(asset:Asset,text:string)=>asset.kind==='bch'?rewardSatoshis(text):integer(text);
export const assetLabel=(a:Asset)=>a.kind==='bch'?'BCH':`CashToken ${a.category} (raw fungible units)`;
export function createQuote(stakingAsset:Asset,rewardAsset:Asset,capText:string,periodsText:string,durationText:string,epoch:string){
 assetId(stakingAsset);assetId(rewardAsset);
 const cap=assetInputUnits(rewardAsset,capText),periods=integer(periodsText),duration=integer(durationText);
 if(cap===null||periods===null||duration===null||!epoch)throw Error('Enter a reward amount, whole periods, whole-second duration and UTC start. BCH supports at most 8 decimal places; tokens require integer units.');
 const parameters:Parameters=validateParameters({version:2,stakingAsset,rewardAsset,cap,periods:Number(periods),periodSeconds:Number(duration),epoch:Date.parse(epoch+'Z')/1000});
 const reserve=cap*periods;
 if(stakingAsset.kind==='token'&&rewardAsset.kind==='bch'){
  const legacy=validateVaultParameters({stakingCategory:stakingAsset.category,cap:Number(cap),periods:parameters.periods,periodSeconds:parameters.periodSeconds,epoch:parameters.epoch});
  const funding=vaultFunding(legacy);
  return {version:1 as const,parameters:legacy,reserve,funding,requiredBch:funding.total+CARRIER,requiredTokens:0n};
 }
 // Same fixed preparation/genesis layout as AssetWallet.prepare. Change is wallet-owned.
 const carriers=3n*CARRIER,fees=2n*FEE,change=CARRIER+(rewardAsset.kind==='token'?CARRIER:0n);
 return {version:2 as const,parameters,reserve,carriers,fees,change,requiredBch:carriers+fees+change+(rewardAsset.kind==='bch'?reserve:0n),requiredTokens:rewardAsset.kind==='token'?reserve:0n};
}
export const V2_CREATION_UNAVAILABLE='V2 experimental — public-wallet creation unavailable. All four pairs pass local BCHN regtest; real WizardConnect/Cashonize signing, recovery and public-provider compatibility still require verification. No wallet authorization is offered for v2 creation.';
