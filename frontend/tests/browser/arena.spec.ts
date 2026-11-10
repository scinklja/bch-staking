import { expect,test } from '@playwright/test';
import { fixture } from '../fixture';
const id='a'.repeat(64);
test('marketplace uses indexed terms and detail links survive reload',async({page})=>{
 await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Staking Arena'})).toBeVisible();
 await page.getByRole('link',{name:/Vault aaaaaa/}).click();await expect(page.getByRole('heading',{name:/Vault aaaaaa/})).toBeVisible();
 await page.reload();await expect(page.getByText('Maximum reward per period',{exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toBeVisible();
 await expect(page.getByRole('row').nth(1)).toContainText('Offer #01');
 await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(1);
});
test('mobile preview forms are usable without suggesting wallet functionality',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id+'/offer');await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();
 for(const [label,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const)await page.getByRole('textbox',{name:label}).fill(value);
 await expect(page.getByText('9,000 raw token units',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Offer submission unavailable'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/#/create');await expect(page.getByRole('button',{name:'Vault publication unavailable'})).toBeDisabled();
 await expect(page.getByRole('option')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('retains snapshot labels across outage, reload and navigation, then recovers',async({page})=>{
 let offline=false;await page.route('**/api/vaults',route=>offline?route.abort():route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id);await expect(page.getByText('Confirmed indexer data',{exact:true})).toBeVisible();
 offline=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('not current');
 await page.reload();await expect(page.getByRole('alert')).toContainText('Saved confirmed snapshot');await expect(page.getByText('Period at snapshot',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Make an Offer'}).click();await expect(page.getByRole('alert')).toContainText('not current');
 offline=false;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
test('empty, malformed and stale API data never invent available vaults',async({page})=>{
 let state='empty';await page.route('**/api/vaults',route=>{const data=fixture();if(state==='empty')data.vaults=[];if(state==='stale')data.health.connected=false;return route.fulfill({json:state==='invalid'?{chain:'main'}:data});});
 await page.goto('/');await expect(page.getByText('No vaults listed',{exact:true})).toBeVisible();
 state='invalid';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('incompatible or malformed');
 state='stale';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByText('Open · at snapshot',{exact:true})).toBeVisible();
});
