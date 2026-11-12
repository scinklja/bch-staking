// Uses the existing isolated Cashonize chipnet profile. No seed/key reads or signing.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const target=process.argv[2]??'https://scinklja.github.io/staking-arena-site/';
const output=process.argv[3]??'../docs/wallet-scan-live.json';
const profiles=resolve('../.chipnet/wizard-wallet-e2e');
const report={startedAt:new Date().toISOString(),target,progress:[],pageErrors:[],signingRequested:false,transactionSubmitted:false};
let wallet,arena,server;
const base=new URL(target);
if(base.hostname==='127.0.0.1'){
 const root=resolve('.pages-production');
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,base).pathname;if(!path.startsWith(base.pathname))throw Error('Outside app path');const file=resolve(root,decodeURIComponent(path.slice(base.pathname.length))||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside assets');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));
}
try{
 wallet=await chromium.launchPersistentContext(resolve(profiles,'cashonize-profile'),launchOptions);
 arena=await chromium.launchPersistentContext(resolve(profiles,'arena-profile'),launchOptions);
 await arena.addInitScript(()=>{
  window.__scanProgress=[];
  window.addEventListener('arena-wallet-progress',event=>window.__scanProgress.push({at:new Date().toISOString(),message:event.detail}));
 });
 const walletPage=wallet.pages()[0]??await wallet.newPage(),page=arena.pages()[0]??await arena.newPage();
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 await walletPage.goto('https://cashonize.com',{waitUntil:'domcontentloaded'});
 // Only inspect the wallet selector, never the body, storage or secret material.
 await walletPage.getByRole('button').filter({hasText:'Arena chipnet authorized E2E'}).waitFor({timeout:30000});
 assert.match(await walletPage.getByRole('button').filter({hasText:'Arena chipnet authorized E2E'}).innerText(),/chipnet/);
 report.wallet='Cashonize';report.walletNetwork='chipnet';
 await page.goto(target+'?scan-check='+Date.now()+'#/create',{waitUntil:'domcontentloaded'});
 try{await page.getByText('Connected to Cashonize',{exact:true}).waitFor({timeout:10000});}
 catch{
  await page.getByRole('button',{name:'Connect Wallet',exact:true}).click();
  const uri=await page.getByRole('textbox',{name:'Connection URI',exact:true}).inputValue();assert.ok(uri.startsWith('wiz:'));
  await walletPage.goto('https://cashonize.com/?uri='+encodeURIComponent(uri),{waitUntil:'domcontentloaded'});
  await walletPage.waitForTimeout(3000);
  report.pairingButtons=await walletPage.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n instanceof HTMLInputElement?n.value:n.textContent));
  console.log(JSON.stringify({pairingButtons:report.pairingButtons}));
  // Consent shares public derivation keys only; no transaction has been prepared.
  await walletPage.getByRole('button',{name:/^(Approve|Connect|Allow)$/i}).click({timeout:15000});
  await page.getByText('Connected to Cashonize',{exact:true}).waitFor({timeout:60000});report.newPublicKeyPairing=true;
 }
 const review=page.getByRole('button',{name:'Review funding in wallet',exact:true});
 assert.equal(await review.isDisabled(),true);
 const started=Date.now();await page.getByRole('button',{name:'Check wallet balances',exact:true}).click();
 await page.getByText('Balances verified on both public providers. The scan is bounded, not proof of the whole wallet balance.',{exact:true}).waitFor({timeout:240000});
 report.scanMs=Date.now()-started;console.log('Live chipnet wallet balances verified.');
 report.balances=await page.getByText(/^Token-free BCH:/).innerText();
 report.progress=await page.evaluate(()=>window.__scanProgress);
 assert.match(report.balances,/120 addresses checked/);
 report.uncheckedDisabled=await review.isDisabled();assert.equal(report.uncheckedDisabled,true);
 const config=JSON.parse(await readFile('../config/electrum-chipnet.json','utf8'));
 await page.getByLabel(/^Staking asset category/).fill(config.vaults[0].stakingCategory);
 await page.getByLabel(/^Maximum reward per period/).fill('0.00002000');
 await page.getByLabel(/^Period duration/).fill('60');
 await page.getByLabel(/^Number of periods/).fill('2');
 await page.getByLabel(/^Schedule starts/).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
 assert.equal(await review.isDisabled(),true);
 await page.getByRole('checkbox').check();
 report.validFormAndConfirmationEnabled=await review.isEnabled();assert.equal(report.validFormAndConfirmationEnabled,true);
 await page.getByLabel(/^Staking asset category/).fill('invalid');assert.equal(await review.isDisabled(),true);
 report.invalidFormDisabled=true;
 // The live wallet has no staking tokens and only 15,000 satoshis: do not
 // request signing. Button readiness does not attest sufficient funding.
 report.reviewButtonNotClicked=true;
 report.operationsText=await page.getByText('No saved operations on this browser.',{exact:true}).innerText();
 report.completedAt=new Date().toISOString();report.completed=true;assert.deepEqual(report.pageErrors,[]);
} catch(error){report.error=String(error);process.exitCode=1;}
finally{
 await arena?.close();await wallet?.close();if(server)await new Promise(done=>server.close(done));await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
