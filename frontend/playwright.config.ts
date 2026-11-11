import { defineConfig } from '@playwright/test';
import { launchOptions } from './scripts/browser-options.mjs';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: 'http://127.0.0.1:5173',
    launchOptions,
    // Keep DOM/network tracing; avoid continuous screencast captures on the VM.
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30000 },
  reporter: [['list']],
});
