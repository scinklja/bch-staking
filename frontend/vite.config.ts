import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Only documented GET endpoints are forwarded. BCHN RPC is never a proxy target.
const proxy = {
  '^/api/transactions/(?:plan|submit|genesis|admit|[a-fA-F0-9]{64})$': { target: 'http://127.0.0.1:3100', rewrite: (path: string) => path.replace(/^\/api/, '') },
  '^/api/(?:health|vaults(?:/[a-fA-F0-9]{64}(?:/(?:offers|rankings|periods|allocations|withdrawals|history))?)?)(?:\\?.*)?$': {
    target: 'http://127.0.0.1:3100',
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};
export default defineConfig({
  plugins: [react()], base: './',
  worker: { format:'es' },
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['@wizardconnect/react'] },
  server: { port: 5173, strictPort: true, proxy, fs: { strict: true, allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { port: 4173, strictPort: true, proxy },
  test: { server: { deps: { inline: [/@wizardconnect\//] } }, maxWorkers: 1, fileParallelism: false, environment: 'jsdom', setupFiles: ['tests/setup.ts'], include: ['tests/*.test.ts', 'tests/*.test.tsx'] },
});
