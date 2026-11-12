// Public confirmed-vault discovery only. Isolated browser storage; never signs or broadcasts.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
const inject=process.env.INJECT_RESTART_FAILURE==='1';
const recover=process.env.RECOVER_RESTART_FAILURE==='1';
let arenaLoads=0;let server;
const target=process.argv[2]??'https://scinklja.github.io/staking-arena-site/';
const fixture=JSON.parse(await readFile('tests/confirmed-import-vault.json','utf8'));
const base=new URL(target);
if(base.hostname==='127.0.0.1'){const root=resolve(process.env.DISCOVERY_ASSETS??'.pages-production');server=createServer(async(req,res)=>{try{const path=new URL(req.url,base).pathname;if(!path.startsWith(base.pathname))throw Error('Invalid path');const file=resolve(root,decodeURIComponent(path.slice(base.pathname.length))||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside assets');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));}
const backendPorts={};for(const port of [18443,48332,3100]){backendPorts[port]=await new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});assert.equal(backendPorts[port],false,`Stop BCHN/API before public verification (${port})`);}
const report={backendPorts,at:new Date().toISOString(),target,vault:fixture,errors:[],failedRequests:[],badResponses:[],workers:[],broadcasts:[]};
const browser=await chromium.launch(launchOptions),context=await browser.newContext();
await context.addInitScript(()=>{
 window.__workers=[];window.__packets=[];window.__diagnostics=[];window.addEventListener('arena-indexer-diagnostic',event=>{window.__diagnostics.push({...event.detail,at:new Date().toISOString()});});
 const Native=window.Worker;window.Worker=class extends Native{
  constructor(...args){super(...args);this.record={url:String(args[0]),messages:[],errors:[]};window.__workers.push(this.record);
   this.addEventListener('error',e=>this.record.errors.push({message:e.message,filename:e.filename,lineno:e.lineno,colno:e.colno,error:String(e.error),stack:e.error?.stack,type:e.type}));
   this.addEventListener('message',e=>{if(e.data?.type==='snapshot'){window.__packet=e.data;window.__packets.push({at:new Date().toISOString(),role:e.data.role,cached:e.data.cached,health:e.data.envelope.health,categories:e.data.envelope.vaults.map(v=>v.category)});}else this.record.messages.push(e.data?.type??Object.keys(e.data??{}));});
  }
  postMessage(data,...args){if(data?.type==='start')this.record.config=data.config;return super.postMessage(data,...args);}
 };
});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push({message:e.message,stack:e.stack}));
context.on('requestfailed',r=>report.failedRequests.push({url:r.url(),failure:r.failure()}));
context.on('response',r=>{if(r.status()>=400)report.badResponses.push({url:r.url(),status:r.status()});});
page.on('worker',w=>report.workers.push(w.url()));
page.on('websocket',s=>s.on('framesent',f=>{if(String(f.payload).includes('blockchain.transaction.broadcast'))report.broadcasts.push(s.url());}));
await context.route('**/*',async route=>{const u=new URL(route.request().url());if(/assets\/arena\.worker-/.test(u.pathname)&&route.request().method()==='GET')arenaLoads++;if(inject&&/assets\/arena\.worker-/.test(u.pathname)&&arenaLoads>1&&(!recover||arenaLoads===2)){await route.fulfill({status:404,contentType:'text/plain',body:'Simulated retired worker asset'});return;}if((['http:','https:'].includes(u.protocol)&&(u.origin!==base.origin||!u.pathname.startsWith(base.pathname)))||/\/api\//.test(u.pathname)){report.errors.push({message:'Prohibited backend request '+u.origin});await route.abort();}else await route.continue();});
try{
 const hash='#/vault/'+fixture.category+'?vault='+encodeURIComponent(JSON.stringify(fixture.config));
 await page.goto(target+hash,{waitUntil:'domcontentloaded'});
 await page.getByTestId('electrum-status').filter({hasText:'Synchronized'}).waitFor({timeout:180000});
 console.log('Initial public Electrum synchronization passed');
 report.beforeImport=await page.locator('body').innerText();
 await page.getByRole('button',{name:'Verify and import vault',exact:true}).click();
 await page.waitForFunction(genesis=>JSON.parse(localStorage.getItem('arena-chipnet-local-vaults-v1')??'[]').some(v=>v.config.genesis===genesis),fixture.config.genesis,{timeout:90000});
 report.importVerified=true;
 if(inject&&!recover){await page.getByText(/Browser indexer worker failed: undefined/).waitFor({timeout:45000});throw Error('Reproduced undefined worker error after imported-vault restart');}
 await page.waitForFunction(category=>window.__packet?.envelope.vaults.some(v=>v.category===category)&&window.__packet.envelope.health.connected&&!window.__packet.envelope.health.stale,fixture.category,{timeout:180000});
 if(recover){await page.waitForFunction(()=>window.__diagnostics?.some(d=>d.resource?.status===404),null,{timeout:15000});report.automaticWorkerRecovery=true;}
 report.visible=true;report.afterImport=await page.locator('body').innerText();
 console.log('Confirmed vault visible after import');
 assert.match(report.afterImport,/Vault d5920d/);assert.match(report.afterImport,/300 seconds/);assert.match(report.afterImport,/0.00001000 BCH/);
 if(process.env.DISCOVERY_EXTENDED==='1'){
  const catalog=await page.evaluate(()=>localStorage.getItem('arena-chipnet-local-vaults-v1'));
  const ready=async p=>p.waitForFunction(category=>window.__packet?.envelope.vaults.some(v=>v.category===category)&&window.__packet.envelope.health.connected&&!window.__packet.envelope.health.stale&&!window.__packet.envelope.health.syncing,fixture.category,{timeout:180000});
  await ready(page);report.indexedVault=await page.evaluate(category=>window.__packet.envelope.vaults.find(v=>v.category===category),fixture.category);
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);report.reload=true;console.log('Reload and checkpoint replay passed');
  assert.equal(await page.evaluate(()=>localStorage.getItem('arena-chipnet-local-vaults-v1')),catalog);
  const second=await context.newPage();await second.goto(target+'#/vault/'+fixture.category);await ready(second);
  assert.match(await second.getByTestId('electrum-status').innerText(),/following another tab/);report.multiTabFollower=true;console.log('Second tab follows the indexing leader');
  await second.close();await page.bringToFront();
  await context.setOffline(true);await page.getByRole('button',{name:'Refresh data',exact:true}).click({timeout:90000});
  await page.getByRole('alert').filter({hasText:'Electrum WSS'}).waitFor({timeout:90000});
  assert.equal(await page.getByText('Vault not found',{exact:true}).count(),0);report.offlineRetainsVault=true;console.log('Outage keeps the known vault historical');
  await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await ready(page);report.providerRecovery=true;console.log('Public Electrum reconnection passed');
  await page.goto(target+'#/vault/'+fixture.config.genesis);await ready(page);assert.match(await page.locator('body').innerText(),/Vault d5920d/);report.genesisAlias=true;
 }
 assert.equal(report.broadcasts.length,0);

}catch(error){report.error=String(error);report.body=await page.locator('body').innerText();process.exitCode=1;}
finally{
 report.instrumentation=await page.evaluate(()=>({workers:window.__workers,packets:window.__packets,diagnostics:window.__diagnostics}));
 report.checkpoints=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('staking-arena-electrum-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('checkpoints'),q=tx.objectStore('checkpoints').getAllKeys();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>r.result.close();};}));
 report.localCatalog=await page.evaluate(()=>localStorage.getItem('arena-chipnet-local-vaults-v1'));
 await writeFile(resolve(process.env.DISCOVERY_REPORT??'../docs/vault-discovery-reproduction.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({visible:report.visible,error:report.error,workerErrors:report.instrumentation.workers.map(w=>w.errors),lastSnapshot:report.instrumentation.packets.at(-1),body:report.body?.slice(-3000)},null,2));
 await browser.close();if(server)await new Promise(done=>server.close(done));
}
