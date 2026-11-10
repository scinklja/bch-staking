import { expect, test } from '@playwright/test';
import { fixture } from '../fixture';

test('production assets render with no configured API and no backend', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name:'The arena, at a glance.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No API is configured');
  await expect(page.getByText('Offline · no API configured', { exact:true })).toBeVisible();
  for (const name of ['Offer marketplace', 'Period history', 'Staker positions']) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByText('The indexer is out of reach', { exact:true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('No API is configured');
  expect(requests.every(url => new URL(url).origin === 'http://127.0.0.1:4174' && !url.includes('/api/'))).toBe(true);
  expect(errors).toEqual([]);
});

test('configured production build handles an unreachable API, saved snapshot, reload and recovery', async ({ page }) => {
  const errors: string[] = [], apiRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let online = false;
  await page.route('https://indexer.example.test/read-only/vaults', route => {
    apiRequests.push(route.request().method());
    return online ? route.fulfill({ json:fixture(), headers:{ 'Access-Control-Allow-Origin':'*' } }) : route.abort();
  });
  await page.goto('/configured/');
  await expect(page.getByRole('alert')).toContainText('Unable to read the indexer');
  await expect(page.getByText('The indexer is out of reach', { exact:true })).toBeVisible();
  online = true;
  await page.getByRole('button', { name:'Refresh data' }).click();
  await expect(page.getByText('Native BCH reserves', { exact:true })).toBeVisible();
  await expect(page.getByText('Indexer synchronized', { exact:true })).toBeVisible();
  online = false;
  await page.reload();
  await expect(page.getByText('Last-known confirmed snapshot · not current', { exact:true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Saved confirmed snapshot');
  await expect(page.getByText('Native BCH reserves', { exact:true })).toBeVisible();
  await page.getByRole('link', { name:'Staker positions' }).click();
  await expect(page.getByText('Recheck synchronization', { exact:true })).toBeVisible();
  online = true;
  await page.getByRole('button', { name:'Refresh data' }).click();
  await expect(page.getByText('Indexer synchronized', { exact:true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(apiRequests.length).toBeGreaterThanOrEqual(4);
  expect(apiRequests.every(method => method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});
