// Production static smoke checks, using one browser to fit the development VM.
import { chromium } from 'playwright-core';
import { fixture } from '../tests/fixture.ts';
import assert from 'node:assert/strict';
await import('./static-server.mjs');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,timeout:180000,args:['--no-sandbox','--disable-gpu','--single-process','--no-zygote','--js-flags=--max-old-space-size=64']});
let page;
try {
 page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(120000);
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 const go=path=>page.goto('http://127.0.0.1:4174'+path,{waitUntil:'domcontentloaded'});
 await go('/');await page.getByRole('heading',{name:'Staking Arena'}).waitFor();await page.getByText('Offline · no API configured',{exact:true}).waitFor();
 assert.equal(requests.filter(r=>r.url.includes('/api/')).length,0);
 await page.getByRole('link',{name:'Create Vault'}).click();await page.getByRole('heading',{name:'Create Vault'}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Form preview',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Vault publication unavailable'}).isEnabled(),false);
 assert.equal(await page.getByRole('option').count(),1);
 console.log('PASS: production offline marketplace, direct creation route and preview-only controls');
 const id='a'.repeat(64);let online=true;
 await page.route('https://indexer.example.test/read-only/vaults',route=>online?route.fulfill({json:fixture(),headers:{'Access-Control-Allow-Origin':'*'}}):route.abort());
 await go('/configured/#/vault/'+id);await page.getByText('Maximum reward per period',{exact:true}).waitFor();
 const rows=page.getByRole('table',{name:'Competing offers ranked by priority'}).getByRole('row');assert.match(await rows.nth(1).textContent(),/Offer #01/);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Maximum reward per period',{exact:true}).waitFor();
 if(!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-vault-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Make an Offer'}).click();await page.getByRole('heading',{name:'Make an Offer'}).waitFor();
 for(const [name,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']])await page.getByRole('textbox',{name}).fill(value);
 await page.getByText('9,000 raw token units',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Offer submission unavailable'}).isEnabled(),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-offer-mobile.png',fullPage:true});
 online=false;await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Last-known confirmed snapshot · not current',{exact:true}).waitFor();
 await page.waitForTimeout(11000);await page.getByText('Last-known confirmed snapshot · not current',{exact:true}).waitFor();
 await go('/configured/#/vault/'+id);await page.getByText('Period at snapshot',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 online=true;await page.getByRole('button',{name:'Refresh data'}).click();await page.getByText('Current period',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
 console.log('PASS: production direct vault/offer routes, ranking, calculation, mobile layout, snapshot persistence and recovery; no JavaScript errors; GET only');
 if(process.env.ARENA_LIVE_URL){
  page=await page.context().newPage();page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(120000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const base=process.env.ARENA_LIVE_URL;const response=await fetch(base+'/api/vaults');assert.equal(response.status,200);const data=await response.json();assert.equal(data.chain,'regtest');assert.equal(data.confirmedOnly,true);
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/#/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Staking Arena'}).waitFor();
  if(data.vaults.length){await page.locator('.vault-row').first().waitFor();if(!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-home-live.png',fullPage:true});const v=data.vaults[0];await page.goto(base+'/#/vault/'+v.category,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/Vault /}).waitFor();await page.getByText('Maximum reward per period',{exact:true}).waitFor();}
  else await page.getByText('No vaults listed',{exact:true}).waitFor();
  if(!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-live-indexer.png',fullPage:true});
  console.log('PASS: actual local indexer data (no fixtures), vaults='+data.vaults.length);
 }
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));console.log('PASS: no browser JavaScript errors; all network requests are GET');
} catch(error) { if(page) console.error('Browser failure:',page.url(),await page.locator('body').innerText().catch(()=>''));throw error; } finally {await browser.close();}
process.exit(0);
