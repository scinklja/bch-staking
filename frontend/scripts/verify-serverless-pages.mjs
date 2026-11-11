// Production public-data verification. Never clicks a processing control or sends a transaction.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const target=process.argv[2]??'https://scinklja.github.io/staking-arena-site/',base=new URL(target),root=process.argv[3]&&resolve(process.argv[3]);
assert.equal(base.pathname,'/staking-arena-site/');
let server,browser;
if(root){server=createServer(async(req,res)=>{const path=new URL(req.url,base).pathname;if(!path.startsWith(base.pathname)){res.writeHead(404).end();return;}const file=resolve(root,decodeURIComponent(path.slice(base.pathname.length))||'index.html');if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}try{res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));}
const report={verifiedAt:new Date().toISOString(),url:target,requests:[],pageErrors:[],failedResponses:[],broadcasts:0};
try{
 browser=await chromium.launch(launchOptions);const context=await browser.newContext(),page=await context.newPage();
 page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(45000);
 await context.addInitScript(()=>{const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data?.type==='snapshot')window.__arenaPacket=event.data;});}};});
 context.on('request',r=>report.requests.push({url:r.url(),method:r.method(),type:r.resourceType()}));context.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 const ready=async()=>{await page.getByTestId('electrum-status').filter({hasText:'Synchronized'}).waitFor({timeout:120000});await page.waitForFunction(()=>window.__arenaPacket?.envelope.health.connected&&!window.__arenaPacket.envelope.health.stale);};
 const started=performance.now(),response=await page.goto(target,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);await ready();
 report.firstSyncMs=Math.round(performance.now()-started);await page.getByText('CHIPNET — TEST FUNDS ONLY',{exact:true}).waitFor();
 assert.match(await page.locator('body').innerText(),/Create Vault and Make an Offer are unavailable/);
 const packet=await page.evaluate(()=>window.__arenaPacket);assert.equal(packet.envelope.chain,'chipnet');assert.equal(packet.envelope.confirmedOnly,true);assert.equal(packet.keeper.automatic,false);assert.ok(packet.envelope.vaults.length>=1);
 report.tip=packet.envelope.tip;report.provider=packet.envelope.health.endpoint;report.vaults=[];
 for(const vault of packet.envelope.vaults){
  await page.goto(target+'#/vault/'+vault.category,{waitUntil:'domcontentloaded'});await ready();await page.getByRole('heading',{name:'Vault '+vault.category.slice(0,6)+'…'+vault.category.slice(-6),exact:true}).waitFor();
  const checkbox=page.getByRole('checkbox',{name:'Enable automatic settlement on chipnet'});assert.equal(await checkbox.isChecked(),false);assert.equal(await checkbox.isEnabled(),true);await page.getByRole('button',{name:'Process Period',exact:true}).waitFor();
  const status=await page.getByTestId('settlement-status').innerText();assert.match(status,/All periods processed|Confirmed|Waiting for the next period|Activation required|Settlement required|Blocked/);
  const body=await page.locator('body').innerText();assert.match(body,/Competing offers/);assert.match(body,/Confirmed indexer data/);
  if(vault.period>=vault.config.periods)assert.equal(await page.getByRole('button',{name:'Process Period',exact:true}).isDisabled(),true);
  const inactive=page.locator('summary').filter({hasText:'Inactive live registrations'});if(await inactive.count()){await inactive.click();for(const offer of vault.offers)await page.getByRole('table',{name:'Inactive registrations'}).getByRole('rowheader',{name:'Offer #'+String(offer.slot).padStart(2,'0')}).waitFor();}
  report.vaults.push({category:vault.category,period:vault.period,periods:vault.config.periods,offers:vault.offers.length,rankings:vault.rankings.length,allocations:vault.allocations.length,status,manualDisabled:await page.getByRole('button',{name:'Process Period',exact:true}).isDisabled()});
  await page.goto(target+'#/vault/'+vault.category+'/offer',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Make an Offer',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Make an Offer',exact:true}).isDisabled(),true);
 }
 await page.goto(target+'#/create',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Create Vault',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);
 await page.goto(target+'#/vault/'+packet.envelope.vaults[0].category,{waitUntil:'domcontentloaded'});await ready();
 report.indexedDbCheckpoints=await page.evaluate(()=>new Promise((done,reject)=>{const r=indexedDB.open('staking-arena-electrum-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('checkpoints'),q=tx.objectStore('checkpoints').count();q.onsuccess=()=>done(q.result);tx.oncomplete=()=>r.result.close();};}));assert.ok(report.indexedDbCheckpoints>=1);
 await context.setOffline(true);await page.getByRole('button',{name:'Refresh data',exact:true}).click();await page.getByRole('alert').filter({hasText:'Electrum WSS'}).waitFor({timeout:90000});assert.match(await page.locator('body').innerText(),/Last-known confirmed snapshot/);report.offlineState=await page.getByRole('alert').innerText();await page.getByRole('button',{name:'Refresh data',exact:true}).waitFor();
 await context.setOffline(false);await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready();report.reconnection=true;
 await page.reload({waitUntil:'domcontentloaded'});await ready();assert.equal(await page.getByRole('checkbox',{name:'Enable automatic settlement on chipnet'}).isChecked(),false);report.reload=true;
 // Read-only protocol probes also verify the second configured production WSS endpoint.
 report.endpoints=[];
 for(const endpoint of ['wss://chipnet.bch.ninja:50004','wss://chipnet.imaginary.cash:50004']){
  const result=await page.evaluate(endpoint=>new Promise((done,reject)=>{const ws=new WebSocket(endpoint),results={},timer=setTimeout(()=>{ws.close();reject(Error('WSS probe timeout: '+endpoint));},20000);ws.onerror=()=>{clearTimeout(timer);reject(Error('WSS probe failed: '+endpoint));};ws.onopen=()=>{for(const [id,method,params] of [[1,'server.version',['arena-pages-verifier','1.5.0']],[2,'blockchain.block.header',[0]],[3,'blockchain.block.header',[121957]],[4,'blockchain.headers.subscribe',[]]])ws.send(JSON.stringify({id,method,params})+'\n');};let buffer='';ws.onmessage=e=>{buffer+=e.data;let i;while((i=buffer.indexOf('\n'))>=0){const data=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(data.error){clearTimeout(timer);ws.close();reject(Error(JSON.stringify(data.error)));return;}if(data.id)results[data.id]=data.result;}if(Object.keys(results).length===4){clearTimeout(timer);ws.close();done(results);}};}),endpoint);
  const hash=hex=>createHash('sha256').update(createHash('sha256').update(Buffer.from(hex,'hex')).digest()).digest().reverse().toString('hex');assert.equal(hash(result[2]),'000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b');assert.equal(hash(result[3]),'0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78');report.endpoints.push({endpoint,version:result[1],height:result[4].height,chipnetPins:true});
 }
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.mobile=true;
 const latest=await page.evaluate(()=>window.__arenaPacket);assert.equal(latest.keeper.automatic,false);assert.equal(await page.evaluate(()=>localStorage.getItem('arena-chipnet-automatic-settlement')),null);
 report.noBackendRequests=!report.requests.some(r=>r.type==='fetch'||r.type==='xhr'||/\/api\/|:3100|:18443|:48332/.test(r.url));assert.equal(report.noBackendRequests,true);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.failedResponses,[]);
 assert.ok(report.requests.every(r=>r.url.startsWith('data:')||(r.method==='GET'&&new URL(r.url).origin===base.origin&&new URL(r.url).pathname.startsWith(base.pathname))));
 report.defaultAutomationDisabled=true;report.processingControlsNotClicked=true;report.completed=true;
 const output=resolve(process.env.PAGES_REPORT??'test-results/serverless-pages-check.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){report.error=String(error);console.error(JSON.stringify(report,null,2));throw error;}finally{await browser?.close();if(server)await new Promise(done=>server.close(done));}
