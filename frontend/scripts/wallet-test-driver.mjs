// Authorized isolated wallet UI test. Never reads or exports seeds/spending keys.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const folder=resolve('../.chipnet/wizard-wallet-e2e');await mkdir(folder,{recursive:true});
// Compiled assets only. No application API, wallet endpoint, or RPC proxy.
const root=resolve('.pages-production'),prefix='/staking-arena-site/';
await readFile(resolve(root,'index.html'));
const assetsServer=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(prefix)){res.writeHead(404).end();return;}const file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise((done,reject)=>{assetsServer.once('error',reject);assetsServer.listen(4184,'127.0.0.1',done);});
const wallet=await chromium.launchPersistentContext(resolve(folder,'cashonize-profile'),launchOptions),arena=await chromium.launchPersistentContext(resolve(folder,'arena-profile'),launchOptions);
const pages={wallet:wallet.pages()[0]??await wallet.newPage(),arena:arena.pages()[0]??await arena.newPage(),faucet:undefined};
const report={startedAt:new Date().toISOString(),network:'chipnet',appRequests:[],appErrors:[],actions:[]};
arena.on('request',r=>{const url=new URL(r.url());report.appRequests.push({origin:url.origin,path:url.pathname,method:r.method()});});pages.arena.on('pageerror',e=>report.appErrors.push(e.message));
await pages.wallet.goto('https://cashonize.com',{waitUntil:'domcontentloaded'});
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.method!=='POST'||req.headers['x-arena-test-driver']!=='isolated-chipnet-ui'){res.writeHead(403).end('{}');return;}
 try{let text='';for await(const chunk of req){text+=chunk;if(text.length>10000)throw Error('Oversized command');}const data=JSON.parse(text);if(!['wallet','arena','faucet'].includes(data.target))throw Error('Invalid target');if(data.target==='faucet'&&!pages.faucet)pages.faucet=await wallet.newPage();const page=pages[data.target];let result;
  if(data.op==='inspect')result={origin:new URL(page.url()).origin,path:new URL(page.url()).pathname,buttons:await page.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n instanceof HTMLInputElement?n.value:n.textContent)),links:await page.locator('a:visible').allTextContents(),inputs:await page.locator('input:visible').evaluateAll(nodes=>nodes.map(n=>({type:n.type,label:n.getAttribute('aria-label'),placeholder:n.placeholder}))),headings:await page.locator('h1,h2').allTextContents()};
  else if(data.op==='click'){await page.getByRole(data.role??'button',{name:data.name,exact:data.exact!==false}).click({timeout:20000});result={clicked:data.name};}
  else if(data.op==='fill'){if(/seed|mnemonic|private|recovery phrase/i.test(data.name??''))throw Error('Seed/key input prohibited');const locator=data.placeholder?page.getByPlaceholder(data.placeholder,{exact:true}):page.getByRole('textbox',{name:data.name,exact:true});await locator.fill(data.value);result={filled:data.name??data.placeholder};}
  else if(data.op==='check'){await page.getByRole('checkbox',{name:data.name,exact:true}).setChecked(data.value!==false);result={checked:data.name};}
  else if(data.op==='goto'){const url=new URL(data.url);const allowed=data.target==='wallet'?url.origin==='https://cashonize.com':data.target==='faucet'?['https://chipnet.bch.ninja','https://tbch.googol.cash'].includes(url.origin):url.origin==='http://127.0.0.1:4184';if(!allowed)throw Error('Unsupported test origin');await page.goto(url.href,{waitUntil:'domcontentloaded'});result={origin:url.origin,path:url.pathname};}
  else if(data.op==='chipnet-setup'){if(data.target!=='wallet')throw Error('Wallet target required');await page.goto('https://cashonize.com',{waitUntil:'domcontentloaded'});await page.locator('nav img[src*="settings"]').click();await page.getByText('Developer settings').click();await page.getByText('Add development wallet').click();if(await page.locator('#addWalletNetwork').inputValue()!=='chipnet')throw Error('Expected chipnet wallet');await page.getByPlaceholder('Enter wallet name').fill('Arena chipnet authorized E2E');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Create new wallet',exact:true}).click();await page.locator('.depositAddr').first().filter({hasText:/^bchtest:/}).waitFor({timeout:30000});result={chipnetWalletCreated:true,address:await page.locator('.depositAddr').first().innerText()};}
  else if(data.op==='nav'){if(!['settings','wallet','connect','tokens'].includes(data.name))throw Error('Unknown navigation');await page.locator('nav img[src*="'+data.name+'"]').click();result={navigated:data.name};}
  else if(data.op==='textclick'){if(/seed|mnemonic|backup|private/i.test(data.name))throw Error('Seed/key navigation prohibited');await page.getByText(data.name,{exact:data.exact===true}).click();result={clicked:data.name};}
  else if(data.op==='select'){await page.getByLabel(data.name,{exact:true}).selectOption(data.value);result={selected:data.name};}
  else if(data.op==='pair'){const uri=await pages.arena.getByRole('textbox',{name:'Connection URI',exact:true}).inputValue();if(!uri.startsWith('wiz:'))throw Error('Expected live WizardConnect URI');await pages.wallet.goto('https://cashonize.com/?uri='+encodeURIComponent(uri),{waitUntil:'domcontentloaded'});result={pairingUriPassedToWallet:true};}
  else if(data.op==='address'){const addresses=await page.getByText(/^bchtest:[a-z0-9]+$/).allTextContents();result={addresses:addresses.filter(a=>/^bchtest:[a-z0-9]+$/.test(a))};}
  else if(data.op==='text'){if(data.target!=='arena')throw Error('Wallet body/seed inspection prohibited');result={text:await page.locator('body').innerText()};}
  else if(data.op==='close'){await wallet.close();await arena.close();await writeFile(resolve(folder,'public-ui-driver-report.json'),JSON.stringify(report,null,2));result={closed:true};server.close();assetsServer.close();}
  else throw Error('Unsupported UI command');
  if(!['inspect','text','address'].includes(data.op))report.actions.push({target:data.target,op:data.op,name:data.name,at:new Date().toISOString()});res.end(JSON.stringify(result));
 }catch(error){res.writeHead(400).end(JSON.stringify({error:String(error).replace(/wiz:[^\s"']+/g,'[redacted pairing URI]').replace(/https:\/\/cashonize.com\/\?[^\s"']+/g,'https://cashonize.com/[pairing redacted]')}));}
});server.listen(4191,'127.0.0.1');console.log('Isolated wallet UI driver ready on 127.0.0.1:4191; no seed/key inspection.');
