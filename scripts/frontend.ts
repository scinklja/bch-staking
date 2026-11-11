// Compatibility entry point: share the duplicate-safe development launcher.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const savedConfig = resolve(root, `${process.env.ARENA_NETWORK === 'regtest' ? '.regtest' : '.chipnet'}/frontend/config.json`);
if (process.argv[2] && resolve(process.argv[2]) !== savedConfig) {
  throw Error(`Frontend startup uses the existing ${savedConfig}; alternate configs are not supported by this launcher.`);
}
const child = spawn(process.execPath, [resolve(root, 'scripts/dev.mjs')], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, FRONTEND_HOST: process.env.FRONTEND_HOST ?? '0.0.0.0' },
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
