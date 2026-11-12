import { ranked, type Envelope, type Vault } from './model';
export type Route = { page:'home'|'create'|'missing' } | { page:'vault'|'offer'; id:string };
export function routeFromHash(hash:string):Route {
  const path=hash.replace(/^#/, '').split('?')[0] || '/';
  if(path==='/') return {page:'home'};
  if(path==='/create') return {page:'create'};
  const match=path.match(/^\/vault\/([a-f0-9]{64})(\/offer)?$/i);
  return match ? {page:match[2]?'offer':'vault',id:match[1].toLowerCase()} : {page:'missing'};
}
export const vaultHref=(id:string)=>`#/vault/${id}`;
export function periodLength(seconds:number) {
  return seconds===86400?'Daily':seconds===604800?'Weekly':seconds===3600?'Hourly':seconds%86400===0?`Every ${seconds/86400} days`:seconds%3600===0?`Every ${seconds/3600} hours`:seconds===60?'Every minute':seconds%60===0?`Every ${seconds/60} minutes`:`Every ${seconds} seconds`;
}
export function vaultStatus(v:Vault,tip:Envelope['tip']) {
  if(v.period>=v.config.periods) return 'Completed';
  if(!tip) return 'Status unavailable';
  return v.period===0 && tip.mtp<v.config.epoch ? 'Upcoming':'Open';
}
export const competingOffers=(v:Vault)=>ranked(v.phase==='activated'?(v.snapshot??v.rankings):v.offers);
export function integer(value:string):bigint|null {
  return /^\d{1,30}$/.test(value)?BigInt(value):null;
}
export function rewardSatoshis(value:string):bigint|null {
  if(!/^\d{1,16}(?:\.\d{1,8})?$/.test(value)) return null;
  const [whole,fraction='']=value.split('.');
  return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
}
export function priority(stake:bigint,duration:bigint,reward:bigint) {
  const numerator=stake*duration;
  const fraction=((numerator%reward)*1000000n/reward).toString().padStart(6,'0').replace(/0+$/,'');
  return `${numerator/reward}${fraction?'.'+fraction:''}`;
}
export function offerPreview(s:string,t:string,r:string,w:string,v:Vault) {
  const stake=integer(s),duration=integer(t),reward=rewardSatoshis(r),wins=integer(w);
  if(stake===null||duration===null||reward===null||wins===null) return {error:'Enter whole token units, whole periods and a BCH amount with up to 8 decimal places.'};
  if(stake<1000n||stake>1000000n) return {error:'Stake must be 1,000–1,000,000 raw token units.'};
  if(duration<1n||duration>BigInt(v.config.periods)||wins<1n||wins>BigInt(v.config.periods)) return {error:`Duration and maximum wins must each be 1–${v.config.periods}.`};
  if(reward<1000n||reward>BigInt(v.config.cap)||reward>1000000n) return {error:'Requested reward must be at least 0.00001000 BCH and no more than the vault cap.'};
  return {commitment:stake*wins,score:priority(stake,duration,reward)};
}
