// Real public chipnet verification of the production static build. Never starts BCHN or an API.
import { chromium } from '@playwright/test';
import { launchOptions } from './browser-options.mjs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const listening=port=>new Promise(done=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));socket.setTimeout(500,()=>{socket.destroy();done(false);});});
const backendPorts={};for(const port of [18443,48332,3100]){backendPorts[port]=await listening(port);assert.equal(backendPorts[port],false,`Stop BCHN/API on port ${port} before verification`);}
const root=resolve(process.argv[2]??'dist'), prefix='/staking-arena-site/';
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(!path.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');
  if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try {const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404).end();}
});
await new Promise((done,reject)=>{server.once('error',reject);server.listen(4180,'127.0.0.1',done);});
let browser;
try {
  browser=await chromium.launch(launchOptions);const context=await browser.newContext(),page=await context.newPage();
  const requests=[],errors=[],workers=[];
  context.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()));
  const ready=page=>page.getByTestId('electrum-status').filter({hasText:'Synchronized'}).waitFor({timeout:90000});
  const began=performance.now();await page.goto(`http://127.0.0.1:4180${prefix}`,{waitUntil:'domcontentloaded'});await ready(page);
  const firstSyncMs=Math.round(performance.now()-began),status=await page.getByTestId('electrum-status').innerText();
  assert.match(status,/chipnet\.(bch\.ninja|imaginary\.cash):50004/);
  await page.getByRole('link',{name:/Vault a79f2b/}).click();await page.getByRole('button',{name:'Withdrawn'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Withdrawn'}).isDisabled(),true);
  const checkpoints=await page.evaluate(async()=>new Promise((done,reject)=>{const r=indexedDB.open('staking-arena-electrum-v1',1);r.onsuccess=()=>{const tx=r.result.transaction('checkpoints');const count=tx.objectStore('checkpoints').count();count.onsuccess=()=>done(count.result);tx.oncomplete=()=>r.result.close();};r.onerror=()=>reject(r.error);}));
  assert.equal(checkpoints,1);
  await context.setOffline(true);await page.getByRole('button',{name:'Refresh data',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Electrum WSS'}).waitFor({timeout:60000});
  const disconnected=await page.getByRole('alert').innerText();
  assert.match(await page.locator('body').innerText(),/Last-known confirmed snapshot/);
  await context.setOffline(false);await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready(page);
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);await page.getByRole('button',{name:'Withdrawn'}).waitFor();
  const second=await context.newPage();await second.goto(`http://127.0.0.1:4180${prefix}`);await ready(second);
  assert.match(await second.getByTestId('electrum-status').innerText(),/following another tab/);
  await page.close();await second.waitForFunction(()=>{const text=document.querySelector('[data-testid="electrum-status"]')?.textContent;return text?.includes('Synchronized')&&!text.includes('following another tab');},{},{timeout:90000});
  assert.equal(requests.some(url=>url.includes('/api/')||url.includes(':3100')||url.includes(':48332')||url.includes(':18443')),false);assert.deepEqual(errors,[]);
  const result={verifiedAt:new Date().toISOString(),sitePrefix:prefix,backendPortsListening:backendPorts,publicProviderStatus:status,firstSyncMs,workerUrls:workers,indexedDbCheckpoints:checkpoints,reload:true,confirmedWithdrawal:true,offlineState:disconnected,providerRecovery:true,multipleTabs:true,leaderTakeover:true,apiRequests:0,pageErrors:errors,httpRequests:requests,settlementImplemented:false,broadcasts:0,deployed:false};
  await writeFile(resolve('../docs/browser-electrum-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {await browser?.close();await new Promise(done=>server.close(done));}
