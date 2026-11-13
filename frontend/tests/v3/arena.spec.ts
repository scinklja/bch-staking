import {test,expect,type Page} from '@playwright/test';
import {v3BrowserChain} from '../../../tests/fixtures/v3-browser-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
let fixture:ReturnType<typeof v3BrowserChain>,hosts:string[]=[],methods:string[]=[];
const certificate=mkdtempSync(tmpdir()+'/arena-v3-wss-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certificate+'/key','-out',certificate+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(certificate+'/key'),cert:readFileSync(certificate+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',(socket,req)=>{hosts.push(req.headers.host??'');socket.on('message',async data=>{const m=JSON.parse(data.toString());methods.push(m.method);try{const result=await fixture.chain.request(m.method,...m.params);socket.send(JSON.stringify({id:m.id,result}));}catch(e){socket.send(JSON.stringify({id:m.id,error:{code:-1,message:String(e)}}));}});});server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const s of sockets.clients)s.terminate();sockets.close();server.close();await once(server,'close');rmSync(certificate,{recursive:true,force:true});});
test.beforeEach(async({context})=>{fixture=v3BrowserChain();hosts=[];methods=[];await context.routeWebSocket(/^wss:\/\/relay\./,s=>{s.onMessage(()=>{});});});
async function refresh(page:Page){const input=page.getByLabel('Public v3 configuration');if(!await input.inputValue())await input.fill(JSON.stringify(fixture.config,(_,v)=>typeof v==='bigint'?v.toString():v));await page.getByRole('button',{name:'Verify and refresh chain state'}).click();await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible({timeout:60000});}
async function open(page:Page){await page.goto('./#/v3');await page.getByLabel('Public v3 configuration').fill(JSON.stringify(fixture.config,(_,v)=>typeof v==='bigint'?v.toString():v));await refresh(page);}
test('real browser worker verifies wallet-funded claims over WSS and requires a connected caller wallet',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await expect(page.getByRole('cell',{name:'513 / 1024'})).toBeVisible();await expect(page.getByRole('button',{name:'Review and pay fee in wallet',exact:true})).toBeDisabled();
 await expect(page.getByText(/connect a compatible WizardConnect/)).toBeVisible();
 const claim=await fixture.claim();await refresh(page);expect(fixture.chain.pending.size).toBe(1);expect(fixture.chain.broadcasts).toHaveLength(1);
 await page.reload();await refresh(page);await expect(page.getByText(/Pending state spends/)).toBeVisible();
 fixture.chain.mine();
 await refresh(page);await expect(page.getByText('1 / 2',{exact:true})).toBeVisible();await expect(page.getByText(/effective lock 1024s/)).toBeVisible();
 expect(hosts.some(h=>h.startsWith('127.0.0.1'))).toBe(true);expect(hosts.some(h=>h.startsWith('localhost'))).toBe(true);expect(methods).toContain('blockchain.transaction.get_merkle');expect(errors).toEqual([]);
});
test('provider failure disables v3 actions and a reorganization restores the queue and allocation state',async({page})=>{
 await open(page);const claim=await fixture.claim();fixture.chain.mine();await refresh(page);await expect(page.getByText(/effective lock 1024s/)).toBeVisible();
 fixture.chain.reorgLastBlock();fixture.chain.pending.add(claim);await refresh(page);await expect(page.getByText('0 / 2',{exact:true})).toBeVisible();await expect(page.getByText(/effective lock 1024s/)).toHaveCount(0);await expect(page.getByRole('button',{name:'Review and pay fee in wallet',exact:true})).toBeDisabled();
 fixture.chain.mine();await refresh(page);await expect(page.getByText('1 / 2',{exact:true})).toBeVisible();
 fixture.chain.fail=true;await page.getByRole('button',{name:'Verify and refresh chain state'}).click();await expect(page.getByRole('heading',{name:'Live ranked queue'})).toHaveCount(0,{timeout:60000});await expect(page.getByRole('status')).toContainText('Fixture disconnected');
 fixture.chain.fail=false;await refresh(page);await expect(page.getByText('1 / 2',{exact:true})).toBeVisible();
});
