import {validateTerms,type Parameters,type Terms} from './model.js';
/** Application policy for NEW offers only. Existing covenant records and journals
 * retain their original terms; this is not a consensus restriction. */
export function validateNewOffer(p:Parameters,terms:Terms,remaining?:bigint){
 if(terms.maxWins!==1)throw Error('New v3 offers must request exactly one reward payment (maxWins = 1)');
 return validateTerms(p,terms,remaining);
}
