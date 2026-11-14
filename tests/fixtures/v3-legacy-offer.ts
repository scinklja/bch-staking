import type {Operation} from '../../src/v3/wallet.js';
/** Recreate a pre-upgrade unsigned W=2 funding journal from the same wallet
 * inputs. Only tests use this: new application offers cannot enter this path. */
export function legacyTwoWinJournal(single:Operation):Operation {
 const op=structuredClone(single),stake=op.terms!.stake,outputs=op.plan!.request.transaction.outputs;
 delete op.offerPolicy;op.terms!.maxWins=2;
 if(op.parameters.stakingAsset.kind==='bch'){
  outputs[0]!.valueSatoshis+=stake;outputs.at(-1)!.valueSatoshis-=stake;
 }else{
  outputs[0]!.token!.amount+=stake;
  outputs.slice(2).find(o=>o.token)!.token!.amount-=stake;
 }
 const label=op.plan!.label.replace(`${stake} `,`${stake*2n} `);
 op.plan!.request.userPrompt=op.plan!.request.userPrompt?.replace(op.plan!.label,label);
 op.plan!.label=label;return op;
}
