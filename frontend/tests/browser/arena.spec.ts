import { expect,test } from '@playwright/test';
import { fixture } from '../fixture';

test('desktop navigation uses the read-only API and distinguishes historical block confirmations',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const apiRequests:string[]=[];
  page.on('request',req=>{if(req.url().includes('/api/')){apiRequests.push(req.url());expect(req.method()).toBe('GET');}});
  await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
  await page.goto('/');await expect(page.getByText('Admitted vaults',{exact:true})).toBeVisible();
  await expect(page.getByText('Native BCH reserves',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Offer marketplace'}).click();
  await expect(page.getByRole('table')).toBeVisible();await expect(page.getByText('Offer #00',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Period history'}).click();
  await expect(page.getByText(/Block 121/)).toBeVisible();
  await expect(page.getByText(/Block 122/)).toBeVisible();
  await expect(page.getByText(/does not supply event block timestamps/)).toBeVisible();
  await page.locator('summary').filter({hasText:'Inspect activated snapshot'}).click();
  await expect(page.getByText('Offer #00',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Staker positions'}).click();
  await expect(page.getByText('Locked at indexed MTP',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:/Filter positions/}).fill('missing');
  await expect(page.getByText('No matching positions')).toBeVisible();
  expect(apiRequests.length).toBeGreaterThan(0);expect(apiRequests.every(url=>new URL(url).pathname==='/api/vaults')).toBeTruthy();expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

test('mobile layout, keyboard navigation and internal table scrolling remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));await page.goto('/');
  await expect(page.getByRole('heading',{name:'The arena, at a glance.'})).toBeVisible();
  await page.getByRole('link',{name:'Offer marketplace'}).click();
  await page.getByRole('checkbox',{name:'Eligible only'}).focus();await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox',{name:'Eligible only'})).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  const scroller=page.locator('.table-scroll');expect(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
  await page.getByRole('link',{name:'Staker positions'}).click();await expect(page.getByText('Locked at indexed MTP',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

test('retains the last successful state on outage and recovers on manual refresh',async({page})=>{
  let outage=false;
  await page.route('**/api/vaults',route=>outage?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:fixture()}));
  await page.goto('/');await expect(page.getByText('Admitted vaults',{exact:true})).toBeVisible();
  outage=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('Refresh failed');
  await expect(page.getByText('Admitted vaults',{exact:true})).toBeVisible();
  outage=false;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('polls live data without reloading and replaces reorganized allocations',async({page})=>{
  let count=0;let changed=false;let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.route('**/api/vaults',route=>{const data=fixture();count++;if(changed){data.vaults[0].allocations=[];data.tip!.hash='1'.repeat(64);}return route.fulfill({json:data});});
  await page.goto('/#positions');await expect(page.getByText('Locked at indexed MTP',{exact:true})).toBeVisible();
  changed=true;await expect(page.getByText('No independent allocations yet')).toBeVisible({timeout:16000});
  expect(navigations).toBe(1);expect(count).toBeGreaterThanOrEqual(2);
});

test('shows stale eligibility warnings, empty vaults and malformed-response recovery',async({page})=>{
  let state='stale';
  await page.route('**/api/vaults',route=>{const data=fixture();if(state==='stale')data.health.updatedAt=new Date(Date.now()-120000).toISOString();if(state==='empty')data.vaults=[];return route.fulfill({json:state==='invalid'?{chain:'main'}:data});});
  await page.goto('/#positions');await expect(page.getByRole('alert')).toContainText('stale');
  await expect(page.getByText('Recheck synchronization',{exact:true})).toBeVisible();
  state='invalid';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('incompatible or malformed');
  state='empty';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByText('No admitted vaults yet')).toBeVisible();
});

test('initial connection failure offers a retry and a loading state',async({page})=>{
  let ready=false;
  await page.route('**/api/vaults',route=>route.fulfill({status:ready?200:502,json:ready?fixture():{error:'offline'}}));
  await page.goto('/');await expect(page.getByText('The indexer is out of reach')).toBeVisible();
  ready=true;await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByText('Admitted vaults',{exact:true})).toBeVisible();
});
