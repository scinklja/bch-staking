import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function recordEvidence(context) {
  await context.tracing.start({ screenshots: false, snapshots: true, sources: true });
}
export async function finishEvidence(page, failed) {
  if (!page) return;
  const context = page.context();
  if (!failed) { await context.tracing.stop(); return; }
  const dir = process.env.ARENA_DIAGNOSTICS_DIR ?? resolve('test-results/standalone-failure');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, 'failure.png'), timeout: 5000 }).catch(error => console.error('Failure screenshot unavailable:', error.message));
  await context.tracing.stop({ path: resolve(dir, 'trace.zip') }).catch(error => console.error('Failure trace unavailable:', error.message));
}
