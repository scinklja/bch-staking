import { defineConfig } from '@playwright/test';
import existing from './playwright.config';
export default defineConfig({
  ...existing, testDir:'./tests/electrum', timeout:90000,
  use:{...existing.use,baseURL:'http://127.0.0.1:4176/electrum/',ignoreHTTPSErrors:true},
  webServer:{command:'ARENA_STATIC_PORT=4176 node scripts/static-server.mjs',url:'http://127.0.0.1:4176',reuseExistingServer:false,timeout:30000},
});
