import {assertNetwork,rpc} from '../src/rpc.js';
import {json} from '../src/arena.js';
import {writeFile} from 'node:fs/promises';
const info=await assertNetwork();
let found:any;
for(let height=info.blocks;height>Math.max(121957,info.blocks-100)&&!found;height--){
  const hash=await rpc('getblockhash',[height]);
  const block=await rpc('getblock',[hash,2]);
  for(const tx of block.tx) for(const output of tx.vout) if(output.tokenData){found={observedAt:new Date().toISOString(),kind:'existing-public-chain-output',network:'chipnet',height,block:hash,txid:tx.txid,vout:output.n,tokenData:output.tokenData};break;}
}
if(!found)throw Error('No token output in last 100 downloaded blocks');
await writeFile('docs/chipnet-token-observation.json',json(found));process.stdout.write(json(found));
