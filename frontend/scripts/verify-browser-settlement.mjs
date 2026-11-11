// Real chipnet transactions: only a static file server and browser are started here.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('../.chipnet/browser-settlement-fixture.json','utf8'));
const open=port=>new Promise(done=>{const s=connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();done(true);});s.once('error',()=>done(false));s.setTimeout(500,()=>{s.destroy();done(false);});});
for(const port of [18443,48332,3100])assert.equal(await open(port),false,`Stop BCHN/API on port ${port}`);
const root=resolve('.static-test/settlement-live'),prefix='/staking-arena-site/';
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');if(!path.startsWith(prefix)||!file.startsWith(root+'/')){res.writeHead(404).end();return;}try{res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.css':'text/css'})[extname(file)]??'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise((done,reject)=>{server.once('error',reject);server.listen(4182,'127.0.0.1',done);});
const report={startedAt:new Date().toISOString(),network:'chipnet',config:fixture.config,category:fixture.parent,initialVaultSatoshis:fixture.initialVaultSatoshis,backendPortsListening:{18443:false,48332:false,3100:false},independentBrowserRace:false,closedAndResumed:false,attempts:[],confirmed:[],pageErrors:[],apiRequests:[],completed:false,broadcastAcknowledgementIsConfirmation:false};
const save=()=>writeFile('../docs/browser-settlement-chipnet-verification.json',JSON.stringify(report,null,2)+'\n');
const observe=context=>{context.on('request',r=>{if(/\/api\/|:3100|:48332|:18443/.test(r.url()))report.apiRequests.push(r.url());});context.on('page',page=>page.on('pageerror',e=>report.pageErrors.push(e.message)));};
async function readDb(page,name,store){return page.evaluate(async({name,store})=>new Promise((done,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains(store)){db.close();done([]);return;}const tx=db.transaction(store),q=tx.objectStore(store).getAll();q.onsuccess=()=>done(q.result);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);}),{name,store});}
async function record(page,label){const intents=await readDb(page,'staking-arena-settlement-v1','intents');for(const i of intents)if(!report.attempts.some(a=>a.txid===i.txid))report.attempts.push({browser:label,txid:i.txid,action:i.action,period:i.period,slot:i.slot,phaseAtFirstObservation:i.phase});const checkpoints=await readDb(page,'staking-arena-electrum-v1','checkpoints'),checkpoint=checkpoints.find(c=>c.vaults?.some(v=>v.config.genesis===fixture.config.genesis)),vault=checkpoint?.vaults.find(v=>v.config.genesis===fixture.config.genesis);if(vault){report.confirmed=vault.history.filter(h=>[2,3,5].includes(h.action)).map(h=>({txid:h.txid,action:h.action,slot:h.slot,period:h.period,height:h.height}));for(const a of report.attempts)a.confirmedInCanonicalLineage=report.confirmed.some(h=>h.txid===a.txid);report.lastStatus=await page.getByTestId('settlement-status').innerText().catch(()=>'?');report.lastObservedAt=new Date().toISOString();}await save();return {vault,checkpoint};}
let browser;
try{
 browser=await chromium.launch(launchOptions);let a=await browser.newContext(),b=await browser.newContext();observe(a);observe(b);
 let pa=await a.newPage(),pb=await b.newPage();const url=`http://127.0.0.1:4182${prefix}#/vault/${fixture.parent}`;
 await Promise.all([pa.goto(url),pb.goto(url)]);
 await Promise.all([pa.getByTestId('settlement-status').filter({hasText:'Activation required'}).waitFor({timeout:120000}),pb.getByTestId('settlement-status').filter({hasText:'Activation required'}).waitFor({timeout:120000})]);
 await Promise.all([pa.getByRole('checkbox',{name:'Enable automatic settlement on chipnet'}).check(),pb.getByRole('checkbox',{name:'Enable automatic settlement on chipnet'}).check()]);report.independentBrowserRace=true;
 const first=Date.now()+120000;while(!report.attempts.length&&Date.now()<first){await record(pa,'A');await record(pb,'B');await new Promise(done=>setTimeout(done,1000));}assert.ok(report.attempts.length,'No browser prepared a transition');
 const state=await a.storageState({indexedDB:true});await writeFile('../.chipnet/browser-settlement-resume.json',JSON.stringify(state),{mode:0o600});await browser.close();
 browser=await chromium.launch(launchOptions);a=await browser.newContext({storageState:state});observe(a);pa=await a.newPage();await pa.goto(url);report.closedAndResumed=true;await save();
 const deadline=Date.now()+90*60*1000;
 for(;;){
  await pa.getByTestId('settlement-status').waitFor({timeout:120000});const {vault,checkpoint}=await record(pa,'resumed A');console.log(JSON.stringify({at:new Date().toISOString(),status:report.lastStatus,confirmed:report.confirmed}));
  if(vault&&Buffer.from(vault.witness,'hex').readUInt32LE(0)===2){
   assert.deepEqual(report.confirmed.map(h=>h.action),[2,3,2,3]);assert.deepEqual(report.confirmed.filter(h=>h.action===3).map(h=>h.slot),[0,0]);
   const rewardLock='76a914'+createHash('ripemd160').update(createHash('sha256').update(Buffer.from(fixture.owners[0].publicKey,'hex')).digest()).digest('hex')+'88ac';
   const txs=checkpoint.blocks.flatMap(b=>b.transactions).filter(tx=>report.confirmed.some(h=>h.action===3&&h.txid===tx.txid));
   for(const tx of txs){assert.equal(tx.vout[2].scriptPubKey.hex,rewardLock);assert.equal(tx.vout[2].satoshis,'1000');assert.equal(tx.vout[2].tokenData,undefined);assert.equal(tx.vout[3].satoshis,'2000');assert.equal(tx.vout[3].tokenData.amount,'2000');assert.equal(tx.vout[3].tokenData.category,fixture.config.stakingCategory);}
   assert.equal(vault.allocations.length,2);assert.equal(vault.transaction.vout[0].satoshis,'14000');report.allocations=vault.allocations.map(a=>({id:a.id,terms:a.terms,amount:a.output.tokenData.amount}));
   Object.assign(report,{finalVaultSatoshis:'14000',canonicalMinerFees:'40000',rewardSatoshis:'2000',allocationCarrierSatoshis:'4000',completed:true,completedAt:new Date().toISOString()});assert.deepEqual(report.apiRequests,[]);assert.deepEqual(report.pageErrors,[]);await save();break;
  }
  if(Date.now()>deadline)throw Error('Timed out awaiting public confirmations; evidence retains pending/confirmed distinction');await new Promise(done=>setTimeout(done,15000));
 }
}catch(error){report.error=String(error);await save();throw error;}finally{await browser?.close();await new Promise(done=>server.close(done));}
