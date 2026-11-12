import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {ElectrumIndexer} from '../src/indexer-core.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {utxo} from '../src/arena-core.js';
import {sourceOutput,validateKeeperTransaction} from '../src/keeper-core.js';
import assert from 'node:assert/strict';
const {config}=JSON.parse(readFileSync('frontend/tests/confirmed-import-vault.json','utf8'));
const peers=['wss://chipnet.imaginary.cash:50004','wss://electrum-chipnet.optnlabs.com'];
const report:any={at:new Date().toISOString(),genesis:config.genesis,config,providers:[],broadcasts:0};
for(const peer of peers){
 let result:any;
 for(let attempt=0;attempt<3;attempt++)try{
  const provider=new BrowserElectrumProvider({endpoints:[peer]}),index=new ElectrumIndexer([config],provider);await index.sync();const vault=index.vaults[0]!;
  assert.equal(Buffer.from(vault.witness,'hex').readUInt32LE(0),2);assert.equal(Buffer.from(vault.witness,'hex')[4],0);
  result=await provider.session(async()=>{
   const tip=await provider.tip(),clock={height:tip.height,mtp:await provider.medianTime(tip.height,tip.hash)};let parent=await provider.transactionStatus(config.genesis);const transitions=[];
   for(const event of vault.history.filter(h=>[2,3,5].includes(h.action))){const tx=await provider.transactionStatus(event.txid);assert.equal(tx.confirmations>0,true);assert.equal(tx.vin.length,2);for(const [n,input]of tx.vin.entries()){assert.equal(input.txid,parent.txid);assert.equal(input.vout,n);}assert.ok(tx.height>parent.height,'next transition uses a separately confirmed parent');
    const validation=validateKeeperTransaction(tx.hex,[sourceOutput(utxo(parent,0)),sourceOutput(utxo(parent,1))],clock,10000n);
    const before=BigInt(parent.vout[0].satoshis),protectedBefore=BigInt(config.periods-event.period)*BigInt(config.cap)+1000n;assert.ok(before-protectedBefore>=10000n);
    transitions.push({txid:tx.txid,parent:parent.txid,height:tx.height,blockhash:tx.blockhash,confirmations:tx.confirmations,period:event.period,action:event.action,fee:validation.fee.toString(),stateBefore:parent.vout[0].satoshis,stateAfter:tx.vout[0].satoshis});parent=tx;
   }
   assert.deepEqual(transitions.map(t=>t.action),[2,5,2,5]);assert.equal(parent.vout[0].satoshis,'27000');assert.equal(parent.vout[1].satoshis,'1000');
   return {peer,tip:{height:tip.height,hash:tip.hash,mtp:clock.mtp},category:vault.category,period:2,phase:'complete',transitions,finalStateOutpoint:parent.txid+':0',stateBch:parent.vout[0].satoshis,poolBch:parent.vout[1].satoshis};
  },peer);break;
 }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
 report.providers.push(result);
}
assert.deepEqual(report.providers[0].transitions.map((t:any)=>({txid:t.txid,blockhash:t.blockhash,fee:t.fee})),report.providers[1].transitions.map((t:any)=>({txid:t.txid,blockhash:t.blockhash,fee:t.fee})));
writeFileSync('docs/mandatory-settlement-chain-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
