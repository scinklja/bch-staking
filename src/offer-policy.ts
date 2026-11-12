import {periodBoundary} from './registry.js';
import type {GenesisParameters} from './genesis-core.js';
export type ScheduledStatus='Scheduled — awaiting start'|'Open for offers'|'Overdue — awaiting activation'|'Activated — awaiting settlement'|'Expired — awaiting on-chain processing'|'Completed — all periods processed on-chain';
/** Frontend policy only. Existing covenants impose activation lower bounds, not registration upper deadlines. */
export function scheduledPolicy(config:GenesisParameters,period:number,activated:boolean,utcSeconds:number,mtp:number) {
 if(!Number.isSafeInteger(period)||period<0||!Number.isFinite(utcSeconds)||utcSeconds<500000000||!Number.isSafeInteger(mtp)||mtp<500000000)throw Error('Verified schedule clock unavailable');
 const time=Math.max(Math.floor(utcSeconds),mtp),end=periodBoundary(config,config.periods),remaining=Math.max(0,config.periods-period);
 const boundary=periodBoundary(config,Math.min(period,config.periods));
 const status:ScheduledStatus=remaining===0?'Completed — all periods processed on-chain':time>=end?'Expired — awaiting on-chain processing':activated?'Activated — awaiting settlement':time>=boundary?'Overdue — awaiting activation':period===0?'Scheduled — awaiting start':'Open for offers';
 return {status,boundary,end,remaining,nextBoundary:remaining?periodBoundary(config,Math.min(period+(activated?1:0),config.periods)):null,steps:remaining*2-(remaining&&activated?1:0),offersAllowed:remaining>0&&!activated&&time<boundary&&time<end};
}
export function assertOfferCutoff(config:GenesisParameters,period:number,activated:boolean,count:number,utcSeconds:number,mtp:number) {
 const schedule=scheduledPolicy(config,period,activated,utcSeconds,mtp);
 if(!schedule.offersAllowed||count>=16)throw Error(`Registration closed by frontend schedule policy: ${schedule.status}; cutoff ${new Date(schedule.boundary*1000).toISOString()}. Wait for confirmed processing before checking a future period. Existing covenants do not enforce this upper deadline.`);
 return schedule.boundary;
}
