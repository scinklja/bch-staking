import {defineConfig} from '@playwright/test';
import existing from './playwright.electrum.config';
export default defineConfig({...existing,workers:1,testMatch:'settlement.spec.ts',webServer:{command:'ARENA_STATIC_PORT=4176 node scripts/static-server.mjs',url:'http://127.0.0.1:4176/settlement/',reuseExistingServer:false,timeout:30000}});
