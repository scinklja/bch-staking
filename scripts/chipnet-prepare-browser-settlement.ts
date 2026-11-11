/** Explicit chipnet-only test fixture creation. Wallet keys stay inside this Node-only setup process.
 * Never imported by the frontend. The subsequent keeper uses neither this wallet nor BCHN. */
import { readFile, writeFile } from 'node:fs/promises';
import { binToHex, cashAddressToLockingBytecode, encodeTransaction, hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { assertNetwork, networkConfig, rpc } from '../src/rpc.js';
import { contract, contracts, provider, utxo, json } from '../src/arena.js';
import { hashState, nextState, offer, remainingCommitment, STATE_SIZE } from '../src/registry.js';
import { decodeRawTransaction } from '../src/electrum-core.js';
if(networkConfig().network!=='chipnet' || !process.argv.includes('--create'))throw Error('Explicit --create and ARENA_NETWORK=chipnet required');
const file='.chipnet/browser-settlement-fixture.json';
try { await readFile(file);throw Error('Fixture already exists; refusing to spend more test funding'); } catch(e:any) {if(e.code!=='ENOENT')throw e;}
const info=await assertNetwork(true),coins=await rpc<any[]>('listunspent',[1,9999999,[],true,{includeTokens:true}]);
const coin=coins.find(c=>c.spendable && !c.tokenData?.nft && BigInt(c.tokenData?.amount??0)>=6000n && Math.round(c.amount*1e8)>=100000);
if(!coin)throw Error('Requires at least 100,000 chipnet satoshis and 6,000 fungible test tokens in the local test wallet');
const stakingCategory=coin.tokenData.category,params={stakingCategory,epoch:info.mediantime-120,periodSeconds:60,periods:2,cap:2000};
const addresses=await Promise.all([rpc<string>('getnewaddress'),rpc<string>('getnewaddress')]);
// Existing wallet-owned keys are used only to prepare two signed registrations; never persisted/exported.
const owners=await Promise.all(addresses.map(async address=>new SignatureTemplate(await rpc<string>('dumpprivkey',[address]))));
const changeAddress=await rpc<string>('getnewaddress'),decode=(address:string)=>{const r=cashAddressToLockingBytecode(address);if(typeof r==='string'||r.prefix!=='bchtest')throw Error('Chipnet address required');return r.bytecode;};
const factory=await contract('RegistryGenesis',[Buffer.from(stakingCategory,'hex').reverse(),BigInt(params.epoch),60n,2n,2000n]);
const value=BigInt(Math.round(coin.amount*1e8));
const unsigned=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin(coin.txid),outpointIndex:coin.vout,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],outputs:[
  {lockingBytecode:decode(factory.address),valueSatoshis:71000n},
  ...addresses.map((address,i)=>({lockingBytecode:decode(address),valueSatoshis:10000n,token:{category:hexToBin(stakingCategory),amount:i===0?4000n:2000n}})),
  {lockingBytecode:decode(changeAddress),valueSatoshis:value-93000n,token:{category:hexToBin(stakingCategory),amount:BigInt(coin.tokenData.amount)-6000n}},
]}));
async function relay(raw:string){const [accept]=await rpc('testmempoolaccept',[[raw]]);if(!accept.allowed)throw Error('Fixture rejected: '+accept['reject-reason']);return rpc<string>('sendrawtransaction',[raw]);}
const signed=await rpc('signrawtransactionwithwallet',[unsigned]);if(!signed.complete)throw Error('Fixture funding signature unavailable');
const parent=await relay(signed.hex),cs=await contracts({...params,genesis:''},parent);
let state:Buffer=Buffer.alloc(STATE_SIZE),tx=decodeRawTransaction(signed.hex);
const raw=new TransactionBuilder({provider}).addInput(utxo(tx,0),factory.unlock.create())
 .addOutput({to:cs.registry.tokenAddress,amount:60000n,token:{category:parent,amount:0n,nft:{capability:'mutable',commitment:hashState(state)}}})
 .addOutput({to:cs.pool.address,amount:1000n}).build();
const genesis=await relay(raw);tx=decodeRawTransaction(raw);
const registrations:string[]=[];
for(let slot=0;slot<2;slot++) {
 const record=offer(owners[slot]!.publicKey,slot===0?2000:1000,slot===0?1:2,1000,2),next=nextState(state,0,slot,record);
 const registration=new TransactionBuilder({provider}).setLocktime(info.mediantime-1)
  .addInput(utxo(tx,0),cs.registry.unlock.transition(state,0n,BigInt(slot),record,owners[slot]!))
  .addInput(utxo(tx,1),cs.pool.unlock.spend())
  .addInput(utxo(decodeRawTransaction(signed.hex),slot+1),owners[slot]!.unlockP2PKH())
  .addOutput({to:cs.registry.tokenAddress,amount:60000n,token:{category:parent,amount:0n,nft:{capability:'mutable',commitment:hashState(next)}}})
  .addOutput({to:cs.pool.tokenAddress,amount:1000n,token:{category:stakingCategory,amount:remainingCommitment(next)}}).build();
 registrations.push(await relay(registration));tx=decodeRawTransaction(registration);state=next;
}
const result={createdAt:new Date().toISOString(),network:'chipnet',config:{...params,genesis},parent,registrations,owners:owners.map((o,i)=>({address:addresses[i],publicKey:binToHex(o.publicKey)})),initialVaultSatoshis:'60000',expectedWinnerSlot:0,expectedRewardSatoshis:'1000',expectedStakeUnits:'2000',note:'Two equal-priority offers; earlier canonical registration must win both periods. Setup only used BCHN; browser keeper must run after it is stopped.'};
await writeFile(file,json(result),{mode:0o600});process.stdout.write(json(result));
