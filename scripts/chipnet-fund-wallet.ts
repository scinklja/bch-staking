import {readFile,writeFile} from 'node:fs/promises';
import {cashAddressToLockingBytecode,encodeTransaction,hexToBin,binToHex} from '@bitauth/libauth';
import {assertNetwork,rpc,networkConfig} from '../src/rpc.js';
import {json} from '../src/arena.js';
import {recordChipnetBroadcast} from '../src/chain-evidence.js';
if(networkConfig().network!=='chipnet')throw Error('Chipnet only');
await assertNetwork(true);
const destination=process.argv[2];if(!destination)throw Error('Pass the chipnet test wallet receive address');
const to=cashAddressToLockingBytecode(destination);
if(typeof to==='string'||to.prefix!=='bchtest')throw Error('Chipnet wallet address required');
const state=JSON.parse(await readFile('.chipnet/provision.json','utf8'));
const change=cashAddressToLockingBytecode(state.fundingAddress);if(typeof change==='string')throw Error(change);
const input=await rpc('gettxout',[state.tokenGenesis,0,true]);
if(!input||input.tokenData?.category!==state.stakingCategory||input.tokenData.nft)throw Error('Test-token supply output unavailable');
const value=BigInt(Math.round(input.value*1e8));
if(value<905000n)throw Error('Need sufficient test carrier funds for the wallet run');
const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin(state.tokenGenesis),outpointIndex:0,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],outputs:[
 {lockingBytecode:to.bytecode,valueSatoshis:400000n},
 {lockingBytecode:to.bytecode,valueSatoshis:500000n,token:{category:hexToBin(state.stakingCategory),amount:1000000n}},
 {lockingBytecode:change.bytecode,valueSatoshis:value-902000n,token:{category:hexToBin(state.stakingCategory),amount:BigInt(input.tokenData.amount)-1000000n}}
]}));
const signed=await rpc('signrawtransactionwithwallet',[raw]);if(!signed.complete)throw Error('Could not sign test funding');
const [accept]=await rpc('testmempoolaccept',[[signed.hex]]);if(!accept.allowed)throw Error(accept['reject-reason']);
const txid=await rpc<string>('sendrawtransaction',[signed.hex]);
await recordChipnetBroadcast('fund-chipnet-wizardconnect-test-wallet',txid);
const result={network:'chipnet',destination,txid,bchFunding:`${txid}:0`,tokenFunding:`${txid}:1`,stakingCategory:state.stakingCategory};
await writeFile('.chipnet/wallet-funding.json',json(result),{mode:0o600});process.stdout.write(json(result));
