import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/api.js';
import {Indexer} from '../src/indexer.js';
import {rpc} from '../src/rpc.js';
test('public frontend receives exact-origin CORS; preflight rejects untrusted origins',async()=>{
 const original=process.env.ARENA_UI_ORIGIN;process.env.ARENA_UI_ORIGIN='https://scinklja.github.io';
 const server=api(new Indexer([]));await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}`;
 const good=await fetch(url+'/transactions/plan',{method:'OPTIONS',headers:{origin:'https://scinklja.github.io'}});assert.equal(good.status,204);assert.equal(good.headers.get('access-control-allow-origin'),'https://scinklja.github.io');
 const bad=await fetch(url+'/transactions/plan',{method:'OPTIONS',headers:{origin:'https://attacker.test'}});assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);
 const read=await fetch(url+'/vaults',{headers:{origin:'https://scinklja.github.io'}});assert.equal(read.headers.get('access-control-allow-origin'),'https://scinklja.github.io');
 }finally{await new Promise<void>(done=>server.close(()=>done()));if(original===undefined)delete process.env.ARENA_UI_ORIGIN;else process.env.ARENA_UI_ORIGIN=original;}
});
test('hosted mode refuses spending-key operations before reaching RPC',async()=>{
 process.env.ARENA_HOSTED='1';try{for(const method of ['signrawtransactionwithwallet','walletprocesspsbt','importprivkey','dumpprivkey','sendtoaddress'])await assert.rejects(()=>rpc(method),/no wallet signing capability/);}finally{delete process.env.ARENA_HOSTED;}
});
