import { expect,test } from '@playwright/test';
import { fixture } from '../fixture';
const id='a'.repeat(64);
test('marketplace uses indexed terms and detail links survive reload',async({page})=>{
 await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Staking Arena'})).toBeVisible();
 await page.getByRole('link',{name:/Vault aaaaaa/}).click();await expect(page.getByRole('heading',{name:/Vault aaaaaa/})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByText('Maximum reward per period',{exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toBeVisible();
 await expect(page.getByRole('row').nth(1)).toContainText('Offer #01');
 await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(1);
});
test('mobile preview forms are usable without suggesting wallet functionality',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id+'/offer',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();
 for(const [label,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const)await page.getByRole('textbox',{name:label}).fill(value);
 await expect(page.getByText('9,000 raw token units',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/#/create',{waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Create Vault'})).toBeDisabled();
 await expect(page.getByRole('option')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('retains snapshot labels across outage, reload and navigation, then recovers',async({page})=>{
 let offline=false;await page.route('**/api/vaults',route=>offline?route.abort():route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id,{waitUntil:'domcontentloaded'});await expect(page.getByText('Confirmed indexer data',{exact:true})).toBeVisible();
 offline=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('not current');
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('alert')).toContainText('Saved confirmed snapshot');await expect(page.getByText('Period at snapshot',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Make an Offer'}).click();await expect(page.getByRole('alert')).toContainText('not current');
 await expect(page.getByRole('button',{name:'Refresh data',exact:true})).toBeEnabled();
 offline=false;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
test('empty, malformed and stale API data never invent available vaults',async({page})=>{
 let state='empty';await page.route('**/api/vaults',route=>{const data=fixture();if(state==='empty')data.vaults=[];if(state==='stale')data.health.connected=false;return route.fulfill({json:state==='invalid'?{chain:'main'}:data});});
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByText('No vaults listed',{exact:true})).toBeVisible();
 state='invalid';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('incompatible or malformed');
 state='stale';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByText('Open · at snapshot',{exact:true})).toBeVisible();
});

test('WizardConnect pairs on demand and Escape cancels the accessible mobile dialog',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 // Keep public relays out of the smoke test; pairing URI generation is local.
 let sockets=0;
 await page.routeWebSocket(/^wss:\/\//,()=>{sockets++;});
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const connect=page.getByRole('button',{name:'Connect Wallet'});
 await expect(connect).toBeVisible();expect(sockets).toBe(0);
 // Native WebSocket silently discards sends after close; Playwright's mock
 // throws instead. Match native behavior for the SDK's async relay cleanup.
 await page.evaluate(()=>{
   const send=WebSocket.prototype.send;
   WebSocket.prototype.send=function(data){if(this.readyState>=WebSocket.CLOSING)return;send.call(this,data);};
 });
 await connect.click();
 const dialog=page.getByRole('dialog',{name:'Connect with WizardConnect'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('canvas')).toBeVisible();
 const uri=await dialog.getByRole('textbox',{name:'Connection URI'}).inputValue();
 expect(uri).toMatch(/^wiz:/i);
 await expect(dialog.getByRole('link',{name:'Open wallet'})).toHaveAttribute('href',uri);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);await expect(connect).toBeVisible();await expect(connect).toBeFocused();
 expect(await page.evaluate(()=>localStorage.getItem('staking-arena-wizardconnect-v1'))).toBeNull();
 expect(errors).toEqual([]);
});
