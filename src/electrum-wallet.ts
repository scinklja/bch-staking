import {Network,type SpendableUtxo} from 'cashscript';
import {ElectrumCore} from './electrum-core.js';
import {json,utxo} from './arena-core.js';
import {walletScript,type WalletKey,type WalletCoin} from './transactions-core.js';
export function walletPeers(p:ElectrumCore){if(p.network!==Network.CHIPNET)throw Error('Wallet transactions are chipnet-only');const peers=p.endpoints.filter((v,i,a)=>a.findIndex(x=>new URL(x).hostname===new URL(v).hostname)===i);if(peers.length<2)throw Error('Two different configured chipnet WSS hosts are required');return peers.slice(0,2);}
export const coinIdentity=(u:SpendableUtxo)=>json({txid:u.txid,vout:u.vout,satoshis:u.satoshis,script:u.lockingBytecode,token:u.token??null});
export async function confirmedWalletTransaction(p:ElectrumCore,id:string){
 let first:any;
 for(const peer of walletPeers(p)){const tx=await p.session(()=>p.transactionStatus(id),peer);if(first&&(first.height!==tx.height||first.blockhash!==tx.blockhash||first.hex!==tx.hex))throw Error('Electrum transaction confirmation disagreement');first=tx;}
 return first;
}
/** Verify supplied public source coins against raw transactions, token UTXOs, proofs and linked tip headers. */
export async function verifyCoins(p:ElectrumCore,coins:SpendableUtxo[],peer:string){
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),transactions=new Map<string,any>();
 for(const coin of coins){
  if(!coin.lockingBytecode)throw Error('Missing source script');
  const actual=(await p.getUtxosForLockingBytecode(coin.lockingBytecode)).find(u=>u.txid===coin.txid&&u.vout===coin.vout);
  if(!actual||coinIdentity(actual)!==coinIdentity(coin))throw Error('Input spent, pending, or changed; rebuild and request fresh approval');
  let status=transactions.get(coin.txid);if(!status){status=await p.transactionStatus(coin.txid);transactions.set(coin.txid,status);}if(status.confirmations<=0)throw Error('Only confirmed wallet/covenant inputs may be spent');
  if(coinIdentity(utxo(status,coin.vout))!==coinIdentity(coin))throw Error('Source-output proof mismatch');
 }
 if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during input verification');
 return {height:tip.height,hash:tip.hash,mtp,peer};
}
export async function verifyCoinsAcrossPeers(p:ElectrumCore,coins:SpendableUtxo[]) {
 let first:Awaited<ReturnType<typeof verifyCoins>>|undefined;
 for(const peer of walletPeers(p)){const value=await p.session(()=>verifyCoins(p,coins,peer),peer);if(first&&(first.hash!==value.hash||first.mtp!==value.mtp))throw Error('Electrum tip/MTP disagreement');first=value;}
 return first!;
}
export interface WalletInventory {coins:WalletCoin[];bch:string;tokens:Record<string,string>;addresses:number;gap:number;limit:number;bounded:true}
export async function scanWallet(p:ElectrumCore,keys:WalletKey[]):Promise<WalletInventory> {
 if(!keys.length||keys.length>600||new Set(keys.map(k=>`${k.path}:${k.index}`)).size!==keys.length)throw Error('Invalid bounded wallet address descriptor');
 for(const key of keys)if(!['receive','change','defi'].includes(key.path)||!Number.isInteger(key.index)||key.index<0||key.index>=200)throw Error('Invalid wallet derivation');
 let first:WalletCoin[]|undefined;let addresses=0;
 for(const peer of walletPeers(p)) {
  const result=await p.session(async()=>{
   const tip=await p.tip(),found:WalletCoin[]=[];let scanned=0;
   for(const path of ['receive','change','defi']) {
    const branch=keys.filter(k=>k.path===path).sort((a,b)=>a.index-b.index);let unused=0;
    for(const key of branch) {
     const script=walletScript(key.publicKey),history=await p.history(script);scanned++;
     unused=history.length?0:unused+1;
     const coins=await p.getUtxosForLockingBytecode(script);
     for(const coin of coins){const entry=history.find(h=>h.tx_hash===coin.txid);if(!entry||entry.height<=0)continue;const tx=await p.transaction(coin.txid,entry.height);await p.verifyHeaderChain(entry.height,tip,new Map([[entry.height,tx.blockhash]]));found.push({...key,utxo:coin});}
     if(unused>=20)break;
    }
   }
   if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during wallet scan');
   return {coins:found.sort((a,b)=>(a.utxo.txid+':'+a.utxo.vout).localeCompare(b.utxo.txid+':'+b.utxo.vout)),scanned};
  },peer);
  if(first&&json(first)!==json(result.coins))throw Error('Electrum wallet UTXO disagreement');first=result.coins;addresses=result.scanned;
 }
 const coins=first!,tokens:Record<string,string>={};
 for(const {utxo:u} of coins)if(u.token&&!u.token.nft)tokens[u.token.category]=(BigInt(tokens[u.token.category]??0)+u.token.amount).toString();
 return {coins,bch:coins.filter(c=>!c.utxo.token).reduce((n,c)=>n+c.utxo.satoshis,0n).toString(),tokens,addresses,gap:20,limit:Math.max(...keys.map(k=>k.index))+1,bounded:true};
}
export function chooseBch(coins:WalletCoin[],required:bigint,used:WalletCoin[]=[]) {
 const selected=[...used];let balance=selected.reduce((n,c)=>n+c.utxo.satoshis,0n);
 for(const c of coins.filter(c=>!c.utxo.token).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {if(balance>=required)break;if(selected.some(x=>x.utxo.txid===c.utxo.txid&&x.utxo.vout===c.utxo.vout))continue;selected.push(c);balance+=c.utxo.satoshis;}
 if(balance<required||selected.length>8)throw Error('Insufficient BCH in the bounded wallet scan (maximum eight inputs); consolidate in your wallet or expand the scan');return selected;
}
export function chooseTokens(coins:WalletCoin[],category:string,amount:bigint) {
 const selected:WalletCoin[]=[];let total=0n;
 for(const c of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.token!.amount>b.utxo.token!.amount?-1:1)){if(total>=amount)break;selected.push(c);total+=c.utxo.token!.amount;}
 if(total<amount||selected.length>8)throw Error('Insufficient selected fungible token balance in the scanned wallet addresses');
 try{return chooseBch(coins,13000n,selected);}catch(error){
  for(const coin of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {
   if(selected.some(c=>c.utxo.txid===coin.utxo.txid&&c.utxo.vout===coin.utxo.vout))continue;
   selected.push(coin);if(selected.length>8)break;
   try{return chooseBch(coins,13000n,selected);}catch{}
  }throw error;
 }

}
