import {test,expect,type Page} from '@playwright/test';
import {WalletFixture} from '../../../tests/fixtures/wallet-chain';
import {settlementConfig} from '../../../tests/fixtures/settlement-chain';
import {parseExtendedJson} from '@wizardconnect/core';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
let fixture:WalletFixture;
const dir=mkdtempSync(tmpdir()+'/arena-wallet-wss-');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key','-out',dir+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(dir+'/key'),cert:readFileSync(dir+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',socket=>socket.on('message',async frame=>{const message=JSON.parse(frame.toString());try{const result=await fixture.chain.request(message.method,...message.params);socket.send(JSON.stringify({id:message.id,result}));}catch(error){socket.send(JSON.stringify({id:message.id,error:{code:-1,message:String(error)}}));}}));server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();server.close();await once(server,'close');rmSync(dir,{recursive:true,force:true});});
test.beforeEach(()=>{fixture=new WalletFixture();});
async function start(page:Page){
 await page.goto('/settlement/');const file=readdirSync('.static-test/settlement/assets').find(f=>f.startsWith('wallet.worker-'))!;expect(file).toBeTruthy();
 await page.evaluate(async({file,config})=>{const worker=new Worker('/settlement/assets/'+file,{type:'module'}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let sequence=0;
  (window as any).walletCall=(method:string,...args:unknown[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});
  await new Promise<void>((resolve,reject)=>{worker.onmessage=event=>{if(event.data.type==='ready'){resolve();return;}const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);event.data.error?task.reject(Error(event.data.error)):task.resolve(event.data.result);};worker.onerror=e=>reject(Error(e.message));});
  await (window as any).walletCall('start',config);
 },{file,config:{network:'chipnet',vaults:[settlementConfig],endpoints:['wss://127.0.0.1:4177','wss://localhost:4177'],timeoutMs:10000,pollMs:1000,maxHistoryEntries:1000,maxTransactions:1000,maxRawBytes:16777216,tabId:'fixture-wallet'}});
}
async function call(page:Page,method:string,...args:unknown[]){const encoded=await page.evaluate(async({method,args})=>{const result=await (window as any).walletCall(method,...args);return JSON.stringify(result,(_k,v)=>typeof v==='bigint'?`<bigint: ${v}n>`:v instanceof Uint8Array?`<Uint8Array: 0x${[...v].map(x=>x.toString(16).padStart(2,'0')).join('')}>`:v);},{method,args});return parseExtendedJson(encoded);}
test('native wallet worker persists signed factory intent, resumes after reload and admits confirmed genesis',async({page})=>{
 await start(page);const balances=await call(page,'scan',fixture.keys);expect(balances.tokens[fixture.asset]).toBe('2500');let op=await call(page,'create',fixture.parameters(),fixture.keys);const signed=fixture.sign(op.plan);op=await call(page,'submit',op.id,signed,fixture.keys);expect(op.stage).toBe('pending');const id=op.id;
 const blocked=await page.evaluate(async id=>navigator.locks.request('arena-chipnet-wallet-submission',async()=>{
  try {await (window as any).walletCall('get',id);return false;}catch(error){return String(error).includes('Another tab');}
 }),id);expect(blocked).toBe(true);
 expect((await call(page,'list')).find((o:any)=>o.id===id).raw).toBe(signed);
 await page.reload();await start(page);expect((await call(page,'list')).find((o:any)=>o.id===id).raw).toBe(signed);fixture.chain.mine();op=await call(page,'advance',id,[]);expect(op.step).toBe('genesis');fixture.chain.mine();op=await call(page,'get',id);expect(op.step).toBe('complete');expect(op.config.genesis).toBe(op.genesis);expect(fixture.chain.broadcasts).toHaveLength(2);
});
test('native wallet worker reserves unsigned funding, permits explicit discard and refuses changed signed outputs',async({page})=>{
 await start(page);await call(page,'scan',fixture.keys);let op=await call(page,'create',fixture.parameters(),fixture.keys);await expect(call(page,'create',fixture.parameters(),fixture.keys)).rejects.toThrow(/Insufficient BCH/);op=await call(page,'cancel',op.id);expect(op.stage).toBe('cancelled');op=await call(page,'create',fixture.parameters(),fixture.keys);op.plan.request.transaction.outputs[0].valueSatoshis--;const raw=fixture.sign(op.plan);await expect(call(page,'submit',op.id,raw,fixture.keys)).rejects.toThrow(/changed/);expect(fixture.chain.broadcasts).toHaveLength(0);
});
