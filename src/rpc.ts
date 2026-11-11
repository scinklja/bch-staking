import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type ArenaNetwork = 'chipnet' | 'regtest';
export function networkConfig(env: NodeJS.ProcessEnv = process.env) {
  const network = env.ARENA_NETWORK ?? 'chipnet';
  if (network !== 'chipnet' && network !== 'regtest') throw Error('Only chipnet and reference regtest are allowed; mainnet is prohibited');
  const chip = network === 'chipnet';
  const url = new URL(env.BCH_RPC_URL ?? `http://127.0.0.1:${chip ? 48332 : 18443}/`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password) throw Error('RPC must use a local cookie-authenticated HTTP endpoint');
  return { network, chain: chip ? 'chip' : 'regtest', prefix: chip ? 'bchtest' : 'bchreg',
    genesis: chip ? '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b' : '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    url, cookie: env.BCH_RPC_COOKIE ?? resolve(chip ? '.chipnet/chipnet/.cookie' : '.regtest/regtest/.cookie'),
    wallet: env.BCH_RPC_WALLET ?? (chip ? 'arena-chipnet' : 'dev') } as const;
}
async function request<T = any>(method: string, params: unknown[] = [], wallet = true): Promise<T> {
  const config = networkConfig();
  const cookie = await readFile(config.cookie, 'utf8');
  const url = new URL(wallet && process.env.ARENA_HOSTED !== '1' ? `/wallet/${encodeURIComponent(config.wallet)}` : '/', config.url);
  const response = await fetch(url, {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from(cookie.trim()).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'staking-arena', method, params }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json() as { result: T; error: unknown };
  if (body.error || !response.ok) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
export async function assertNetwork(requireReady = false) {
  const config = networkConfig();
  const info = await request('getblockchaininfo', [], false);
  if (info.chain !== config.chain || await request('getblockhash', [0], false) !== config.genesis) throw Error('BCHN chain identity mismatch');
  // Chipnet shares genesis with testnet4: pin a post-fork checkpoint as well.
  if (config.network === 'chipnet' && (requireReady || info.blocks >= 121957)) {
    if (await request('getblockhash', [121957], false) !== '0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78') throw Error('Chipnet fork identity mismatch');
    if (requireReady && (info.initialblockdownload || info.blocks !== info.headers || Date.now()/1000 - info.mediantime > 21600)) throw Error('Chipnet is not synchronized');
    if (requireReady && (!(await request('getnetworkinfo', [], false)).networkactive || !(await request('getconnectioncount', [], false)))) throw Error('Chipnet relay is offline');
  }
  return info;
}
export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  if (process.env.ARENA_HOSTED === '1' && /^(sign|wallet|dump|import|createwallet|loadwallet|getnewaddress|listunspent|fundraw|sendto|sendmany)/i.test(method)) throw Error('Hosted backend has no wallet signing capability');
  // All RPC signing, wallet sends and raw broadcasts re-check the actual chain.
  if (/^(send|sign|submit)/i.test(method) || method.toLowerCase() === 'walletprocesspsbt') await assertNetwork(true);
  if (networkConfig().network === 'chipnet' && /^(generate|setmocktime)/i.test(method)) throw Error('Mining and mock time are disabled on chipnet');
  return request<T>(method, params);
}
export async function assertRegtest() {
  if (networkConfig().network !== 'regtest') throw Error('Reference tests require ARENA_NETWORK=regtest');
  return assertNetwork();
}
