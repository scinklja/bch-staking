/** Live read-only verification. No keys, wallet RPC, broadcast, mining or keeper. */
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ElectrumProvider } from '../src/electrum.js';
import { Indexer } from '../src/indexer.js';
import { api, vaultView } from '../src/api.js';
import { json } from '../src/arena.js';
process.env.ARENA_NETWORK='chipnet';
process.env.BCH_RPC_COOKIE='/nonexistent-electrum-verification-cookie';
process.env.BCH_RPC_URL='http://127.0.0.1:1/';
const config = JSON.parse(await readFile(process.argv[2] ?? 'config/electrum-chipnet.json','utf8'));
const directory = await mkdtemp(join(tmpdir(),'arena-electrum-live-'));
try {
  const index = new Indexer(config.vaults, join(directory,'checkpoint.json'), new ElectrumProvider());
  await index.sync(); await index.verifyUtxos();
  const before = json(index.vaults), restarted = new Indexer(config.vaults,index.path,new ElectrumProvider());
  await restarted.load(); await restarted.sync();
  if (json(restarted.vaults)!==before) throw Error('Vault state changed across restart; retry on stable chain');
  const server=api(restarted);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`, checks: Record<string,number>={};
  try {
    for (const path of ['/health','/vaults',...restarted.vaults.flatMap(v=>['','/offers','/rankings','/periods','/allocations','/withdrawals','/history'].map(p=>`/vaults/${v.category}${p}`)),...config.vaults.map((v:any)=>`/transactions/${v.genesis}`)]) {
      const response=await fetch(base+path); checks[path]=response.status;
      if(response.status!==200) throw Error(`API verification failed: ${path} ${response.status}`);
    }
    checks['POST /transactions/plan']=(await fetch(base+'/transactions/plan',{method:'POST'})).status;
    if(checks['POST /transactions/plan']!==405)throw Error('Electrum API permitted a write');
  } finally {server.close();await once(server,'close');}
  const result={verifiedAt:new Date().toISOString(),network:'chipnet',endpoint:restarted.electrum!.endpoint,bchn:{url:process.env.BCH_RPC_URL,cookie:process.env.BCH_RPC_COOKIE,availableToProcess:false},tip:restarted.tip&&{height:restarted.tip.height,hash:restarted.tip.hash,mtp:restarted.tip.mtp},restartIdentical:true,checks,vaults:restarted.vaults.map(v=>({genesis:v.config.genesis,category:v.category,actions:v.history.map(h=>({txid:h.txid,action:h.action,height:h.height})),allocations:v.allocations.map(a=>({id:a.id,withdrawal:a.withdrawal})),bchSatoshis:vaultView(restarted,v.category)!.bchSatoshis})),broadcasts:0,trustModel:'Server-selected linked headers and Merkle inclusion; server-trusted complete history and unspent status. Not full consensus validation.'};
  const output=process.argv[3];if(output)await writeFile(output,json(result));
  process.stdout.write(json(result));
} finally {await rm(directory,{recursive:true,force:true});}
