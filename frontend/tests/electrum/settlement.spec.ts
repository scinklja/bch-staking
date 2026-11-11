import {test,expect,type Page} from '@playwright/test';
import {SettlementChain,settlementConfig} from '../../../tests/fixtures/settlement-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
let chain:SettlementChain,disconnectAfterAccept=false;
const cert=mkdtempSync(tmpdir()+'/arena-settlement-wss-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',cert+'/key','-out',cert+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(cert+'/key'),cert:readFileSync(cert+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',(socket,request)=>socket.on('message',async frame=>{
 const data=JSON.parse(frame.toString());
 try {
  if(chain.disagree&&request.headers.host?.startsWith('localhost')&&data.method==='blockchain.scripthash.get_history'){socket.send(JSON.stringify({id:data.id,result:[]}));return;}
  const result=await chain.request(data.method,...data.params);
  if(disconnectAfterAccept&&data.method==='blockchain.transaction.broadcast'){disconnectAfterAccept=false;socket.close();return;}
  socket.send(JSON.stringify({id:data.id,result}));
 }catch(error){socket.send(JSON.stringify({id:data.id,error:{code:-1,message:String(error)}}));}
}));server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const s of sockets.clients)s.terminate();sockets.close();server.close();await once(server,'close');rmSync(cert,{recursive:true,force:true});});
test.beforeEach(()=>{chain=new SettlementChain();disconnectAfterAccept=false;});
const category=()=>chain.transactions.get(settlementConfig.genesis)!.vin[0]!.txid;
async function open(page:Page){await page.goto(`http://127.0.0.1:4176/settlement/#/vault/${category()}`);await expect(page.getByTestId('settlement-status')).toContainText('Activation required',{timeout:60000});}
const status=(page:Page)=>page.getByTestId('settlement-status');

test('native browser automatically activates and settles two periods, paying the canonical tied winner',async({page})=>{
 await open(page);await page.getByRole('checkbox',{name:'Enable automatic settlement on chipnet'}).check();
 for(const action of [2,3,2,3]) {
  await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);
  const id=[...chain.pending][0]!,tx=chain.transactions.get(id)!;
  const witness=await import('../../../src/arena-core');expect(witness.transitionWitness(tx.vin[0]!.scriptSig.hex).action).toBe(action);
  if(action===3){expect(tx.vout[2]!.satoshis).toBe('1000');expect(tx.vout[3]!.tokenData?.amount).toBe('2000');}
  chain.mine();await expect(status(page)).toContainText('Confirmed',{timeout:30000});
 }
 await expect.poll(()=>chain.broadcasts.length).toBe(4);
 await expect(page.getByText('All periods processed',{exact:false})).toBeVisible();
 expect(chain.transactions.get([...chain.confirmed].filter(([,h])=>h===chain.height)[0]![0])!.vout[0]!.satoshis).toBe('14000');
});
test('two independent browser users race safely; one canonical transaction spends the outpoint',async({browser,page})=>{
 const other=await browser.newContext({ignoreHTTPSErrors:true}),second=await other.newPage();
 try {await Promise.all([open(page),open(second)]);await Promise.all([page.getByRole('checkbox').check(),second.getByRole('checkbox').check()]);
  await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);expect(new Set(chain.broadcasts).size).toBe(1);
  chain.mine();await expect.poll(()=>[...chain.confirmed.values()].filter(h=>h===chain.height).length).toBe(1);
 }finally{await other.close();}
});
test('manual processing works with automation disabled and always waits for confirmation',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Process Period'}).click();await expect(status(page)).toContainText('Pending confirmation',{timeout:30000});
 expect(await page.getByRole('checkbox').isChecked()).toBe(false);expect(chain.broadcasts.length).toBe(1);
 chain.mine();await expect(status(page)).toContainText('Confirmed');await expect(status(page)).toContainText('Settlement required');expect(chain.broadcasts.length).toBe(1);
 await page.getByRole('button',{name:'Process Period'}).click();await expect.poll(()=>chain.pending.size).toBe(1);expect(chain.broadcasts.length).toBe(2);
});
test('disconnect after submission survives reload without resubmitting; tab leadership transfers safely',async({context,page})=>{
 await open(page);disconnectAfterAccept=true;await page.getByRole('button',{name:'Process Period'}).click();
 await expect.poll(()=>chain.pending.size).toBe(1);await page.reload();await expect(status(page)).toContainText('Pending confirmation',{timeout:30000});expect(chain.broadcasts.length).toBe(1);
 const second=await context.newPage();await second.goto(`/settlement/#/vault/${category()}`);await expect(status(second)).toContainText('Pending confirmation',{timeout:30000});
 await page.close();chain.mine();await expect(status(second)).toContainText('Confirmed',{timeout:30000});expect(chain.broadcasts.length).toBe(1);
});
test('provider disagreement and mempool rejection produce retries without optimistic settlement',async({page})=>{
 await open(page);chain.disagree=true;await page.getByRole('button',{name:'Process Period'}).click();
 await expect(status(page)).toContainText('disagreement',{timeout:30000});expect(chain.broadcasts.length).toBe(0);
 chain.disagree=false;chain.rejectNext=true;await page.getByRole('button',{name:'Process Period'}).click();
 await expect(status(page)).toContainText('txn-mempool-conflict',{timeout:30000});expect(chain.pending.size).toBe(0);
});
