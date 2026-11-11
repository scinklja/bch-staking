import {readFile,writeFile} from 'node:fs/promises';
import {ElectrumNetworkProvider,Network} from 'cashscript';
import {binToHex,hashTransactionUiOrder,hexToBin} from '@bitauth/libauth';
import {assertNetwork,rpc} from '../src/rpc.js';
import {json} from '../src/arena.js';
await assertNetwork(true);
const hostname=process.env.CHIPNET_ELECTRUM_HOST??'chipnet.imaginary.cash';
const remote=new ElectrumNetworkProvider(Network.CHIPNET,{manualConnectionManagement:true,hostname});
await remote.connect();
try {
const checkpoint=await remote.performRequest('blockchain.block.header',121957);
if(typeof checkpoint!=='string'||binToHex(hashTransactionUiOrder(hexToBin(checkpoint)))!=='0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78')throw Error('Independent Electrum chipnet fork mismatch');
const receipts=(await readFile('.chipnet/broadcasts.jsonl','utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const results=[];
for(const receipt of receipts){
 const local=await rpc('getrawtransaction',[receipt.txid,true]);
 const raw=await remote.getRawTransaction(receipt.txid);
 if(raw!==local.hex||binToHex(hashTransactionUiOrder(hexToBin(raw)))!==receipt.txid)throw Error('Relay transaction differs');
 results.push({...receipt,independentElectrumObserved:true,confirmations:local.confirmations??0,confirmationBlock:local.blockhash??null});
}
const height=await remote.getBlockHeight();
const tipHeader=await remote.performRequest('blockchain.block.header',height);
if(typeof tipHeader!=='string')throw Error('Invalid independent tip header');
const tipHash=binToHex(hashTransactionUiOrder(hexToBin(tipHeader)));
const local=await assertNetwork(true);
const sync={observedAt:new Date().toISOString(),network:'chipnet',independentElectrumServer:hostname,independentHeight:height,independentHash:tipHash,localHeight:local.blocks,localHash:local.bestblockhash,matches:height===local.blocks&&tipHash===local.bestblockhash};
await writeFile('docs/chipnet-sync-verification.json',json(sync));
if(!sync.matches)throw Error('Local and independent chipnet tips differ; retry');
const evidence={observedAt:new Date().toISOString(),network:'chipnet',independentElectrumServer:hostname,independentForkCheckpointVerified:true,transactions:results};
await writeFile('docs/chipnet-relay-verification.json',json(evidence));process.stdout.write(json(evidence));

} finally { await remote.disconnect(); }
