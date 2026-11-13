import {defineConfig} from '@playwright/test';
import existing from './playwright.electrum.config';
export default defineConfig({...existing,testDir:'./tests/v3',timeout:120000,use:{...existing.use,baseURL:'http://127.0.0.1:4176/v3/'}});
