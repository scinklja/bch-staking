import {useEffect,useState} from 'react';
import {apiBaseUrl} from './api';
type Receipt={txid:string;status:string;confirmations?:number;error?:string};
const key='staking-arena-chipnet-receipts';
const statusLabels:Record<string,string>={submitted:'Broadcast submitted, awaiting observation',pending:'Unconfirmed (0-conf)',confirmed:'Confirmed','not-observed':'Broadcast submitted, awaiting observation','reorg-or-dropped':'No longer observed — possible reorg, dropped or replaced'};
const statusLabel=(status:string)=>statusLabels[status]??status;
export function rememberTransaction(txid:string){
  if(!/^[a-f0-9]{64}$/i.test(txid))return;
  let saved:Receipt[]=[];try{saved=JSON.parse(localStorage.getItem(key)??'[]');}catch{}
  localStorage.setItem(key,JSON.stringify([{txid,status:'submitted'},...saved.filter(r=>r.txid!==txid)].slice(0,25)));
  window.dispatchEvent(new Event('arena-transactions'));
}
export default function TransactionStatus(){
 const [rows,setRows]=useState<Receipt[]>(()=>{try{return JSON.parse(localStorage.getItem(key)??'[]');}catch{return [];}});
 const [error,setError]=useState('');
 useEffect(()=>{
  let stopped=false,busy=false;
  const refresh=async()=>{
   if(busy)return;busy=true;
   try {
   let saved:Receipt[]=[];try{saved=JSON.parse(localStorage.getItem(key)??'[]');}catch{}
   const base=apiBaseUrl();if(!base)return;
   const next=await Promise.all(saved.map(async r=>{
    try{const response=await fetch(`${base}/transactions/${r.txid}`,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(response.status===404)return {txid:r.txid,status:['confirmed','pending','reorg-or-dropped'].includes(r.status)?'reorg-or-dropped':'not-observed'};
      if(!response.ok)throw Error('API unavailable');
      const data=await response.json();if(data.chain!=='chipnet'||data.txid!==r.txid||!Number.isSafeInteger(data.confirmations)||data.confirmations<0||!['pending','confirmed'].includes(data.status)||(data.status==='confirmed')!==(data.confirmations>0))throw Error('Incompatible transaction response');
      return {txid:r.txid,status:data.status,confirmations:data.confirmations};
    }catch{return {...r,status:'unavailable — last result may be stale'};}
   }));
   if(!stopped){
    let latest:Receipt[]=saved;try{latest=JSON.parse(localStorage.getItem(key)??'[]');}catch{}
    const byId=new Map(next.map(r=>[r.txid,r]));
    const merged=latest.map(r=>byId.get(r.txid)??r);
    localStorage.setItem(key,JSON.stringify(merged));setRows(merged);
   }
   } finally {busy=false;}
  };
  const changed=()=>{void refresh();};
  const failed=(event:Event)=>setError((event as CustomEvent<string>).detail);
  window.addEventListener('arena-transactions',changed);window.addEventListener('arena-transaction-error',failed);
  void refresh();const timer=setInterval(refresh,10000);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('arena-transactions',changed);window.removeEventListener('arena-transaction-error',failed);};
 },[]);
 if(!rows.length&&!error)return null;
 return <section aria-label="Transaction activity"><h2>Transaction activity</h2>{error&&<p role="alert">Transaction failed: {error}</p>}{rows.map(r=><p key={r.txid}><code>{r.txid}</code> · {statusLabel(r.status)}{r.confirmations!==undefined?` · ${r.confirmations} confirmation(s)`:''}</p>)}<small>Confirmations can change after a reorg. Unavailable API results do not prove a transaction failed.</small></section>;
}
