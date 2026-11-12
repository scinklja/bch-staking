// Real, authorized permissionless processing of the existing vault only. Never creates offers/vaults or requests wallet signing.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('tests/confirmed-import-vault.json','utf8'));
const base=new URL(process.env.SETTLEMENT_SITE??'http://127.0.0.1:4189/staking-arena-site/');
const root=resolve(process.env.SETTLEMENT_ASSETS??'../.pages-release/mandatory-settlement-source/frontend/.pages-production');
const folder=resolve('../.chipnet/mandatory-settlement-e2e');await mkdir(folder,{recursive:true});
const output=resolve('../docs/mandatory-settlement-live.json');
const report={startedAt:new Date().toISOString(),site:base.href,fixture,events:[],errors:[],walletMethods:[],completed:false};let serial=Promise.resolve();
const save=()=>serial=serial.catch(()=>{}).then(()=>writeFile(output,JSON.stringify(report,null,2)+'\n'));
let assets;
if(base.hostname==='127.0.0.1'){
 assets=createServer(async(req,res)=>{try{const path=new URL(req.url,base).pathname;if(!path.startsWith(base.pathname))throw Error('Invalid path');const file=resolve(root,decodeURIComponent(path.slice(base.pathname.length))||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside assets');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(done=>assets.listen(Number(base.port),'127.0.0.1',done));
}
const contexts={},pages={},packets={};
async function open(name){
 if(contexts[name])return;
 const context=contexts[name]=await chromium.launchPersistentContext(resolve(folder,name),launchOptions);
 await context.addInitScript(({config,category})=>{
  const list=JSON.parse(localStorage.getItem('arena-chipnet-local-vaults-v1')??'[]');if(!list.some(v=>v.config.genesis===config.genesis))localStorage.setItem('arena-chipnet-local-vaults-v1',JSON.stringify([...list,{config,category}]));
  localStorage.setItem('arena-chipnet-automatic-settlement','false');
  window.__walletMethods=[];
  const Native=window.Worker;window.Worker=class extends Native{
   constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data?.type==='snapshot')window.__packet=event.data;});}
   postMessage(message,...rest){if(message?.method){window.__walletMethods.push(message.method);if(['authorize','submit','offer','create','advance','recover','v2'].includes(message.method))throw Error('Wallet spending forbidden during live keeper verification');}return super.postMessage(message,...rest);}
  };
 },fixture);
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&(u.origin!==base.origin||!u.pathname.startsWith(base.pathname))){report.errors.push({browser:name,error:'Forbidden HTTP/API request',url:u.origin+u.pathname});return route.abort();}return route.continue();});
 const page=pages[name]=context.pages()[0]??await context.newPage();page.on('pageerror',e=>report.errors.push({browser:name,error:e.message,stack:e.stack}));
 await page.goto(base.href+'#/vault/'+fixture.category,{waitUntil:'domcontentloaded'});
 console.log(name+': browser opened; legacy disable preference seeded, no wallet connected');
}
await open('primary');
let last={},busy=false;
async function sample(){if(busy)return;busy=true;try{for(const [name,page] of Object.entries(pages)){
 const data=await page.evaluate(category=>{
  const p=window.__packet,v=p?.envelope.vaults.find(v=>v.category===category);return {at:new Date().toISOString(),health:p?.envelope.health,tip:p?.envelope.tip,role:p?.role,automatic:p?.keeper.automatic,status:p?.keeper.statuses[category],vault:v?{period:v.period,phase:v.phase,bchSatoshis:v.bchSatoshis,history:v.history.map(h=>({txid:h.txid,height:h.height,action:h.action,period:h.period}))}:undefined,
   walletMethods:window.__walletMethods,legacyPreference:localStorage.getItem('arena-chipnet-automatic-settlement'),optOuts:[...document.querySelectorAll('input[type=checkbox]')].map(e=>e.parentElement?.textContent),offerDisabled:document.querySelector('a[aria-disabled]')?.getAttribute('aria-disabled'),statusText:document.querySelector('.page-title .badge')?.textContent};
 },fixture.category);
 if(data.status){data.intent=await page.evaluate(category=>new Promise(resolve=>{const request=indexedDB.open('staking-arena-settlement-v1',1);request.onerror=()=>resolve(undefined);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('intents')){db.close();resolve(undefined);return;}const tx=db.transaction('intents'),read=tx.objectStore('intents').get(category);read.onsuccess=()=>{const i=read.result;resolve(i?{txid:i.txid,parent:i.parent,phase:i.phase,action:i.action,period:i.period,attempts:i.attempts,updatedAt:i.updatedAt}:undefined);};read.onerror=()=>resolve(undefined);tx.oncomplete=()=>db.close();};}),fixture.category);}
 packets[name]=data;const identity=JSON.stringify([data.health?.error,data.status,data.vault,data.role]);
 if(last[name]!==identity){last[name]=identity;report.events.push({browser:name,...data});if(report.events.length>1500)report.events.shift();console.log(JSON.stringify({browser:name,at:data.at,phase:data.status?.phase,message:data.status?.message,txid:data.status?.txid,period:data.vault?.period,status:data.statusText}));}
 assert.equal(data.walletMethods.some(m=>['authorize','submit','offer','create'].includes(m)),false);report.walletMethods=[...new Set([...report.walletMethods,...data.walletMethods])];
 if(data.vault&&data.health?.connected&&!data.health.stale&&!data.health.syncing){assert.equal(data.automatic,true);assert.equal(data.legacyPreference,null);assert.equal(data.optOuts.length,0);assert.equal(data.offerDisabled,'true');
  if(data.vault.period>=fixture.config.periods){report.completed=true;report.confirmedHistory=data.vault.history;report.completedAt=data.at;report.final=data;}
 }
 }await save();}catch(error){report.errors.push({at:new Date().toISOString(),error:String(error)});await save();}finally{busy=false;}}
await sample();const timer=setInterval(()=>{void sample();},5000);
const control=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');if(req.method!=='POST'||req.headers['x-arena-live-check']!=='mandatory-existing-vault'){res.writeHead(403).end('{}');return;}
 try{let raw='';for await(const c of req)raw+=c;if(raw.length>1024)throw Error('Oversized command');const command=JSON.parse(raw||'{}');
  if(command.op==='status'){await sample();res.end(JSON.stringify({completed:report.completed,errors:report.errors,last:packets}));return;}
  if(command.op==='other')await open('secondary');
  else if(command.op==='reload')await pages.primary.reload({waitUntil:'domcontentloaded'});
  else if(command.op==='offline')await contexts.primary.setOffline(true);
  else if(command.op==='online'){await contexts.primary.setOffline(false);await pages.primary.bringToFront();await pages.primary.evaluate(()=>window.dispatchEvent(new Event('online')));}
  else if(command.op==='close'){clearInterval(timer);await sample();for(const c of Object.values(contexts))await c.close();await save();res.end(JSON.stringify({closed:true,completed:report.completed}));control.close();assets?.close();return;}
  else throw Error('Unsupported read/recovery command');
  report.events.push({at:new Date().toISOString(),control:command.op});await save();res.end(JSON.stringify({ok:true}));
 }catch(error){res.writeHead(400).end(JSON.stringify({error:String(error)}));}
});await new Promise(done=>control.listen(4195,'127.0.0.1',done));
console.log('Live existing-vault monitor on 127.0.0.1:4195. Browser remains open for confirmed sequential processing.');
