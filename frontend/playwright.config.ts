import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir:'./tests/browser', timeout:90000, expect:{timeout:15000}, workers:1, fullyParallel:false,
  use:{actionTimeout:15000,navigationTimeout:30000,baseURL:'http://127.0.0.1:5173',launchOptions:{executablePath:process.env.CHROMIUM_PATH??(existsSync('/usr/lib/chromium/chromium')?'/usr/lib/chromium/chromium':'/usr/bin/chromium'),args:['--no-sandbox','--disable-gpu','--renderer-process-limit=1']},trace:'retain-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000},
  reporter:[['list']],
});
