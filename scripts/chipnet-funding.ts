import { ElectrumNetworkProvider,Network } from 'cashscript';
import { cashAddressToLockingBytecode,decodeTransaction,hexToBin,binToHex,hashTransactionUiOrder } from '@bitauth/libauth';
import { readFile,writeFile } from 'node:fs/promises';
import { assertNetwork,rpc } from '../src/rpc.js';
import { json } from '../src/arena.js';
await assertNetwork(true);
const funding=JSON.parse(await readFile('.chipnet/funding.json','utf8'));
const remote=new ElectrumNetworkProvider(Network.CHIPNET,{hostname:process.env.CHIPNET_ELECTRUM_HOST??'chipnet.imaginary.cash'});
const raw=await remote.getRawTransaction(funding.userReportedTransaction);
if(binToHex(hashTransactionUiOrder(hexToBin(raw)))!==funding.userReportedTransaction)throw Error('Funding transaction hash mismatch');
const tx=decodeTransaction(hexToBin(raw)),address=cashAddressToLockingBytecode(funding.address);
if(typeof tx==='string'||typeof address==='string'||address.prefix!=='bchtest')throw Error('Invalid funding transaction/address');
const output=tx.outputs.find(o=>binToHex(o.lockingBytecode)===binToHex(address.bytecode)&&!o.token);
if(!output)throw Error('Reported funding does not pay the test wallet');
let local;
try{local=await rpc('getrawtransaction',[funding.userReportedTransaction,true]);}catch{
 const [accept]=await rpc('testmempoolaccept',[[raw]]);if(!accept.allowed)throw Error(`Funding rejected: ${accept['reject-reason']}`);
 await rpc('sendrawtransaction',[raw]);local=await rpc('getrawtransaction',[funding.userReportedTransaction,true]);
}
const evidence={observedAt:new Date().toISOString(),network:'chipnet',txid:funding.userReportedTransaction,address:funding.address,satoshis:output.valueSatoshis.toString(),independentElectrumObserved:true,confirmations:local.confirmations??0,confirmationBlock:local.blockhash??null};
await writeFile('docs/chipnet-funding-verification.json',json(evidence));process.stdout.write(json(evidence));
