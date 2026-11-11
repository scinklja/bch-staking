import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { SignatureTemplate } from 'cashscript';
import { ElectrumProvider } from '../src/electrum.js';
import { Indexer } from '../src/indexer.js';
import { Keeper, type Sponsorship } from '../src/keeper.js';
import { api } from '../src/api.js';
import { type VaultConfig, contract, utxo, json } from '../src/arena.js';
import { rpc } from '../src/rpc.js';

const file = process.argv[2];
if (!file) throw Error('Usage: npm run arena -- CONFIG.json');
const config: { vaults: VaultConfig[]; checkpoint: string; port?: number; pollMs?: number; keeper?: boolean; sponsorOutpoints?: string[] } = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(config.vaults) || !config.checkpoint || (config.pollMs ?? 2000) < 100 || !Number.isInteger(config.port ?? 3100)) throw Error('Invalid service configuration');
// Linux abstract sockets are released by the OS on exit, including SIGKILL: no stale lock deletion race.
const lock = createServer();
await new Promise<void>((resolveLock, reject) => {
  lock.once('error', error => reject(new Error(
    `Cannot lock checkpoint ${resolve(config.checkpoint)}: ${error.message}. Another indexer may already own it; use npm run dev to reuse healthy services.`,
  )));
  lock.listen('\0staking-arena-' + createHash('sha256').update(resolve(config.checkpoint)).digest('hex'), resolveLock);
});
const useElectrum = process.env.ARENA_PROVIDER === 'electrum';
if (useElectrum && (config.keeper || process.env.ARENA_SPONSOR_KEY || process.env.ARENA_NETWORK === 'regtest')) throw Error('Electrum service is chipnet and read-only; keeper and sponsorship require BCHN');
const index = new Indexer(config.vaults, config.checkpoint, useElectrum ? new ElectrumProvider() : undefined);
await index.load();
let sponsorship: Sponsorship | undefined;
if (process.env.ARENA_HOSTED === '1' && process.env.ARENA_SPONSOR_KEY) throw Error('Hosted service must not hold spending keys');
if (process.env.ARENA_SPONSOR_KEY) {
  if (!/^[0-9a-f]{64}$/i.test(process.env.ARENA_SPONSOR_KEY)) throw Error('Sponsor key must be 32-byte hex');
  const key = new SignatureTemplate(Buffer.from(process.env.ARENA_SPONSOR_KEY, 'hex'));
  const deposit = await contract('RegistryDeposit', [key.publicKey]);
  sponsorship = async () => {
    for (const point of config.sponsorOutpoints ?? []) {
      if (!/^[0-9a-f]{64}:\d+$/.test(point)) throw Error('Invalid sponsor outpoint');
      const [txid, n] = point.split(':');
      const available = await rpc('gettxout', [txid, Number(n), true]);
      if (!available) continue;
      if (available.tokenData || available.scriptPubKey.hex !== deposit.lockingBytecode) throw Error('Sponsor output must be BCH-only at the configured key deposit');
      const tx = await rpc('getrawtransaction', [txid, true]);
      return { input: utxo(tx, Number(n)), unlocker: deposit.unlock.spend(key) };
    }
    return undefined;
  };
}
const keeper = new Keeper(index, sponsorship), server = api(index, async vault => {
  const updated = { ...config, vaults: [...config.vaults.filter(v => v.genesis !== vault.genesis), vault] };
  await writeFile(`${file}.tmp`, json(updated), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
});
server.listen(config.port ?? 3100, process.env.ARENA_BIND ?? '127.0.0.1');
let stopped = false, polling = false, timer: NodeJS.Timeout | undefined;
function stop() { stopped = true; if (timer) clearTimeout(timer); server.close(); if (!polling) lock.close(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
async function poll() {
  polling = true;
  try {
    if (config.keeper) process.stdout.write(json(await keeper.tick())); else await index.sync();
  } catch (e) { process.stderr.write(json({ error: String(e), retry: true })); }
  polling = false;
  if (stopped) lock.close();
  if (!stopped) timer = setTimeout(poll, config.pollMs ?? 2000);
}
await poll();
