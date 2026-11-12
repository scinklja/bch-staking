import type { GenesisParameters } from './genesis-core.js';
import { periodBoundary } from './registry.js';
export interface OfferTerms {stake:number;duration:number;reward:number;maxWins:number}
export function validateVaultParameters(p:GenesisParameters) {
 if(!p || !/^[a-f0-9]{64}$/.test(p.stakingCategory) || ![p.epoch,p.periodSeconds,p.periods,p.cap].every(Number.isSafeInteger) || p.periods<1 || p.periods>16 || p.cap<1000 || p.cap>1000000)throw Error('Invalid chipnet vault parameters');
 periodBoundary(p,2*p.periods-1);return p;
}
/** Existing Node minimum reserve, including its additional 20,000-satoshi excess buffer. */
export function vaultFunding(p:GenesisParameters) {
 validateVaultParameters(p);
 const rewards=BigInt(p.periods)*BigInt(p.cap),stateCarrier=1000n,poolCarrier=1000n,futureFees=BigInt(p.periods)*20000n,futureAllocationCarriers=BigInt(p.periods)*2000n,buffer=20000n,genesisFee=10000n,fundingFee=2000n;
 const reserve=rewards+stateCarrier+futureFees+futureAllocationCarriers+buffer,factory=reserve+poolCarrier+genesisFee;
 return {rewards,stateCarrier,poolCarrier,futureFees,futureAllocationCarriers,buffer,genesisFee,fundingFee,reserve,factory,total:factory+fundingFee};
}
export function validateOfferTerms(p:GenesisParameters,t:OfferTerms) {
 validateVaultParameters(p);
 if(!t || !Object.values(t).every(Number.isSafeInteger) || t.stake<1000 || t.stake>1000000 || t.duration<1 || t.duration>p.periods || t.maxWins<1 || t.maxWins>p.periods || t.reward<1000 || t.reward>p.cap)throw Error('Offer terms violate covenant bounds');
 return BigInt(t.stake)*BigInt(t.maxWins);
}
