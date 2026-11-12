import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rpc } from './rpc.js';

/** Temporary loopback-only BCHN peer. Never shares or replaces the development datadir. */
export async function relayPeer() {
  const cached = globalThis.process.env.ARENA_RELAY_CACHE === '1';
  const directory = cached ? join(globalThis.process.cwd(), '.regtest/relay-policy') : await mkdtemp(join(tmpdir(), 'staking-standard-relay-'));
  if(cached)await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory, 'bitcoin.conf'), `regtest=1
server=1
listen=1
dnsseed=0
discover=0
upnp=0
natpmp=0
acceptnonstdtxn=0
txbroadcastinterval=100
txindex=1
dbcache=32
par=1
[regtest]
connect=0
bind=127.0.0.1:18445
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=18446
`);
  const process = spawn('/home/omarchy/.local/bin/bitcoind', [`-datadir=${directory}`, '-regtest'], { stdio: 'ignore' });
  async function peer<T = any>(method: string, params: unknown[] = []): Promise<T> {
    const cookie = await readFile(join(directory, 'regtest/.cookie'), 'utf8');
    const response = await fetch('http://127.0.0.1:18446', { method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(cookie.trim()).toString('base64')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'relay', method, params }), signal: AbortSignal.timeout(10000) });
    const body = await response.json() as { result: T; error: unknown };
    if (body.error || !response.ok) throw Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  async function until(predicate: () => Promise<boolean>, label: string, timeout = 60000) {
    const end = Date.now() + timeout;
    do {
      if (process.exitCode !== null || process.signalCode !== null) throw Error(`BCHN peer exited: ${process.exitCode ?? process.signalCode}; datadir ${directory}`);
      try { if (await predicate()) return; } catch { /* Node startup or chain sync. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < end);
    throw Error(`Relay peer timeout: ${label}`);
  }
  async function close() {
    await rpc('setnetworkactive', [false]);
    try { await peer('stop'); } catch { process.kill('SIGTERM'); }
    await new Promise<void>(resolve => { if (process.exitCode !== null) resolve(); else process.once('exit', () => resolve()); });
  }
  try {
    await until(async () => { if (process.exitCode !== null) throw Error(`BCHN peer exited ${process.exitCode}`); return (await peer('getblockchaininfo')).chain === 'regtest'; }, 'startup');
    await rpc('setnetworkactive', [true]);
    await rpc('addnode', ['127.0.0.1:18445', 'onetry']);
    const tip = (await rpc('getblockchaininfo')).bestblockhash;
    // RPC readiness can precede the peer's P2P listener; retry loopback dialing if necessary.
    let lastDial=Date.now(), lastSyncReport=Date.now(), observed: any;
    try {
      await until(async () => {
        observed=await peer('getblockchaininfo');
        if(observed.bestblockhash===tip)return true;
        if(Date.now()-lastSyncReport>30000){lastSyncReport=Date.now();console.log(`Loopback relay initial sync: height ${observed.blocks}, headers ${observed.headers}`);}
        if(Date.now()-lastDial>2000 && !(await peer('getpeerinfo')).length) {
          lastDial=Date.now();await rpc('addnode',['127.0.0.1:18445','onetry']);
        }
        return false;
      }, 'initial block sync', 600000);
    } catch(error) { throw Error(`${String(error)}; local tip ${tip}; peer ${JSON.stringify(observed)}`); }
    assert.equal((await peer('getnetworkinfo')).connections, 1);
    return { directory, peer, until, close };
  } catch (error) { await close(); throw error; }
}
