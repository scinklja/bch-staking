import {rpc,assertNetwork} from '../src/rpc.js';
const txid=process.argv[2];if(!txid||!/^[0-9a-f]{64}$/i.test(txid))throw Error('Pass a transaction ID');
for(;;){
 try {
 await assertNetwork(true);
 const tx=await rpc('getrawtransaction',[txid,true]);
 console.log(JSON.stringify({observedAt:new Date().toISOString(),txid,confirmations:tx.confirmations??0,block:tx.blockhash??null}));
 if(tx.confirmations>0)break;
 }catch(error){console.log(JSON.stringify({observedAt:new Date().toISOString(),retry:String(error)}));}
 await new Promise(done=>setTimeout(done,30000));
}
