import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  const cookie = await readFile(fileURLToPath(new URL('../.regtest/regtest/.cookie', import.meta.url)), 'utf8');
  const response = await fetch('http://127.0.0.1:18443/wallet/dev', {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from(cookie.trim()).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'local-regtest', method, params }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json() as { result: T; error: unknown };
  if (body.error || !response.ok) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
export async function assertRegtest() {
  const info = await rpc('getblockchaininfo');
  if (info.chain !== 'regtest') throw new Error('Only regtest is allowed');
}
