import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNetwork,networkConfig,rpc } from '../src/rpc.js';
test('chipnet configuration excludes mainnet and rejects unsafe RPC endpoints',()=>{
  assert.equal(networkConfig({}).network,'chipnet');
  assert.equal(networkConfig({ARENA_NETWORK:'regtest'}).prefix,'bchreg');
  for(const env of [{ARENA_NETWORK:'mainnet'},{BCH_RPC_URL:'https://example.com/'},{BCH_RPC_URL:'http://user:password@localhost/'}]) assert.throws(()=>networkConfig(env));
});
test('chain, fork, synchronization and relay gates run before any RPC signing or broadcast',async()=>{
  const original={...process.env},fetcher=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'arena-network-'));
  await writeFile(join(dir,'cookie'),'local:simulation');
  process.env.ARENA_NETWORK='chipnet';process.env.BCH_RPC_COOKIE=join(dir,'cookie');
  let chain='chip',fork=true,ibd=false,peers=1;
  const called:string[]=[];
  globalThis.fetch=async(_url,init)=>{
    const {method,params}=JSON.parse(init!.body as string);called.push(method);
    const result=method==='getblockchaininfo'?{chain,blocks:331817,headers:331817,initialblockdownload:ibd,mediantime:Math.floor(Date.now()/1000)}:method==='getblockhash'?(params[0]===0?networkConfig().genesis:fork?'0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78':'00'.repeat(32)):method==='getnetworkinfo'?{networkactive:true}:method==='getconnectioncount'?peers:'simulated';
    return new Response(JSON.stringify({result,error:null}));
  };
  try {
    await assertNetwork(true);
    for(const failure of ['mainnet','fork','ibd','relay']){
      chain=failure==='mainnet'?'main':'chip';fork=failure!=='fork';ibd=failure==='ibd';peers=failure==='relay'?0:1;called.length=0;
      await assert.rejects(()=>rpc('sendrawtransaction',['00']));assert.ok(!called.includes('sendrawtransaction'));
      await assert.rejects(()=>rpc('signrawtransactionwithwallet',['00']));assert.ok(!called.includes('signrawtransactionwithwallet'));
      await assert.rejects(()=>rpc('walletprocesspsbt',['invalid']));assert.ok(!called.includes('walletprocesspsbt'));
    }
    await assert.rejects(()=>rpc('generatetoaddress',[1,'bchtest:fake']));
  } finally {globalThis.fetch=fetcher;process.env=original;await rm(dir,{recursive:true});}
});
