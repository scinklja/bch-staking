import { recordChipnetBroadcast } from '../src/chain-evidence.js';
import { readFile,writeFile,rename } from 'node:fs/promises';
import { binToHex,cashAddressToLockingBytecode,encodeTransaction,hexToBin } from '@bitauth/libauth';
import { assertNetwork,networkConfig,rpc } from '../src/rpc.js';
import { json } from '../src/arena.js';

if(networkConfig().network!=='chipnet') throw Error('Chipnet test funds only');
await assertNetwork(true);
const file='.chipnet/provision.json';
let state:any;
try {state=JSON.parse(await readFile(file,'utf8'));} catch(error:any){if(error.code!=='ENOENT')throw error;state={network:'chipnet',fundingAddress:process.env.CHIPNET_FUNDING_ADDRESS??await rpc<string>('getnewaddress',['chipnet-faucet'])};}
const save=async()=>{await writeFile(file+'.tmp',json(state),{mode:0o600});await rename(file+'.tmp',file);};
await save();
const address=await rpc('getaddressinfo',[state.fundingAddress]);
if(!address.ismine) throw Error('Configured test funding address is not in this node wallet');
const destination=cashAddressToLockingBytecode(state.fundingAddress);
if(typeof destination==='string'||destination.prefix!=='bchtest') throw Error('Invalid chipnet funding address');
async function broadcast(raw:string){
  const signed=await rpc('signrawtransactionwithwallet',[raw]);
  if(!signed.complete)throw Error('Test wallet could not sign token provisioning');
  const [accept]=await rpc('testmempoolaccept',[[signed.hex]]);
  if(!accept.allowed)throw Error(`Provisioning rejected: ${accept['reject-reason']}`);
  const txid=await rpc<string>('sendrawtransaction',[signed.hex]);
  await recordChipnetBroadcast('test-token-provision',txid);
  return txid;
}
if(!state.pregenesis){
  const coins=await rpc<any[]>('listunspent',[0,9999999,[state.fundingAddress]]);
  const coin=coins.find(c=>!c.tokenData&&c.spendable&&Math.round(c.amount*1e8)>=500000);
  if(!coin)throw Error(`Awaiting at least 500,000 available chipnet satoshis at ${state.fundingAddress}; faucet requires a human CAPTCHA`);
  const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin(coin.txid),outpointIndex:coin.vout,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],outputs:[{lockingBytecode:destination.bytecode,valueSatoshis:BigInt(Math.round(coin.amount*1e8))-2000n}]}));
  state.pregenesis=await broadcast(raw);await save();
}
if(!state.tokenGenesis){
  const tx=await rpc('getrawtransaction',[state.pregenesis,true]);
  const value=BigInt(Math.round(tx.vout[0].value*1e8))-2000n;
  const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin(state.pregenesis),outpointIndex:0,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],outputs:[{lockingBytecode:destination.bytecode,valueSatoshis:value,token:{category:hexToBin(state.pregenesis),amount:1000000000n}}]}));
  state.tokenGenesis=await broadcast(raw);state.stakingCategory=state.pregenesis;state.supply='1000000000';await save();
}
const broadcasts=[];
for(const [step,txid] of [['token-pregenesis',state.pregenesis],['token-genesis',state.tokenGenesis]]){
  const tx=await rpc('getrawtransaction',[txid,true]);
  broadcasts.push({step,txid,confirmations:tx.confirmations??0,status:tx.confirmations>0?'confirmed':'broadcast'});
}
process.stdout.write(json({network:'chipnet',stakingCategory:state.stakingCategory,supply:state.supply,fundingAddress:state.fundingAddress,broadcasts}));
