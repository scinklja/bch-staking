import { expect,test } from '@playwright/test';
import { fixture } from '../fixture';
const id='a'.repeat(64);
test('production offline build renders marketplace and creation preview with no backend',async({page})=>{
 const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Staking Arena'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('No API is configured');
 await page.getByRole('link',{name:'Create Vault'}).click();await expect(page.getByText('Chipnet test funds only',{exact:true})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Create Vault'})).toBeDisabled();
 expect(requests.every(url=>new URL(url).origin==='http://127.0.0.1:4174'&&!url.includes('/api/'))).toBe(true);expect(errors).toEqual([]);
});
test('configured production hash routes, offer preview and persistent outage labels work',async({page})=>{
 let online=true;await page.route('https://indexer.example.test/read-only/vaults',route=>online?route.fulfill({json:fixture(),headers:{'Access-Control-Allow-Origin':'*'}}):route.abort());
 await page.goto('/configured/#/vault/'+id,{waitUntil:'domcontentloaded'});await expect(page.getByText('Current period',{exact:true})).toBeVisible();
 online=false;await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('alert')).toContainText('Saved indexed snapshot');
 await page.getByRole('link',{name:'Make an Offer'}).click();await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('not current');
 await expect(page.getByRole('button',{name:'Refresh data',exact:true})).toBeEnabled();
 online=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
