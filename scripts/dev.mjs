import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, rename, realpath, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
process.chdir(root);
const network = process.env.ARENA_NETWORK ?? 'chipnet';
if (!['chipnet', 'regtest'].includes(network)) throw Error('Only chipnet or reference regtest is allowed');
const chip = network === 'chipnet';
const dataDirectory = resolve(root, chip ? '.chipnet' : '.regtest');
const rpcPort = chip ? 48332 : 18443;
const chain = chip ? 'chip' : 'regtest';
const walletName = chip ? 'arena-chipnet' : 'dev';
const directory = resolve(dataDirectory, 'dev');
const statePath = resolve(directory, 'services.json');
const configPath = resolve(dataDirectory, 'frontend/config.json');
const host = process.env.FRONTEND_HOST ?? '0.0.0.0';
const owned = [];
let stopping = false;
const log = message => console.log(`[arena] ${message}`);
const delay = ms => new Promise(done => setTimeout(done, ms));
const env = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };
delete env.ARENA_SPONSOR_KEY;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

// Kernel-owned locks survive neither crashes nor reboot, and require no stale-file deletion.
async function lock(interruptible = true) {
  const address = '\0staking-arena-dev-' + createHash('sha256').update(root).digest('hex');
  for (let attempt = 0; attempt < 600; attempt++) {
    const server = createServer();
    try {
      await new Promise((done, reject) => {
        server.once('error', reject);
        server.listen(address, done);
      });
      return () => new Promise(done => server.close(done));
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (!attempt) log('Waiting for another startup/shutdown to finish…');
      if (interruptible && stopping) throw Error('Interrupted while waiting for startup lock');
      await delay(250);
    }
  }
  throw Error('Another startup/shutdown has held the launcher lock for 150 seconds. Inspect its logs.');
}

async function identity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return { pid: Number(pid), start: fields[19], boot };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}
async function alive(record) {
  return record.boot === boot && (await identity(record.pid))?.start === record.start;
}
async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function saveState(state) {
  await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(`${statePath}.tmp`, statePath);
}
function listeners(port) {
  const output = execFileSync('ss', ['-H', '-lntp', `sport = :${port}`], { encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean).map(line => ({
    address: line.trim().split(/\s+/)[3],
    pids: [...line.matchAll(/pid=(\d+)/g)].map(match => Number(match[1])),
  }));
}
async function processInfo(pid) {
  const [cwd, command] = await Promise.all([
    realpath(`/proc/${pid}/cwd`), readFile(`/proc/${pid}/cmdline`, 'utf8'),
  ]);
  return { cwd, args: command.split('\0').filter(Boolean) };
}
async function verifyListener(name, port) {
  const sockets = listeners(port);
  if (!sockets.length) return false;
  for (const socket of sockets) {
    const expectedAddress = name === 'Vite' ? `${host}:5173` : `127.0.0.1:${port}`;
    if ((socket.address !== expectedAddress && !(chip && name === 'BCHN' && socket.address === `[::1]:${port}`)) || !socket.pids.length) {
      throw Error(`${name}: port ${port} is bound at ${socket.address}; expected ${expectedAddress} with an identifiable local process. Inspect: ss -lntp`);
    }
    for (const pid of socket.pids) {
      const { cwd, args } = await processInfo(pid);
      let matches = false;
      if (name === 'BCHN') {
        matches = args.some(a => a.endsWith('bitcoind')) && args.includes(`-datadir=${dataDirectory}`) && args.includes(chip ? '-chipnet' : '-regtest');
      } else if (name === 'indexer') {
        const index = args.findIndex(a => resolve(cwd, a) === resolve(root, 'scripts/arena.ts'));
        matches = index >= 0 && args[index + 1] && await realpath(resolve(cwd, args[index + 1])) === await realpath(configPath);
      } else {
        matches = cwd === resolve(root, 'frontend') && args.some(a => /(?:^|\/)vite(?:\.js)?$/.test(a));
      }
      if (!matches) throw Error(`${name}: port ${port} belongs to another process (PID ${pid}). It was left untouched. Inspect: ss -lntp`);
    }
  }
  return true;
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function rpc(method, params = []) {
  const cookie = (await readFile(resolve(dataDirectory, `${chip ? 'chipnet' : 'regtest'}/.cookie`), 'utf8')).trim();
  const response = await fetch(`http://127.0.0.1:${rpcPort}/`, {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from(cookie).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'arena-dev', method, params }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw Error(`BCHN ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function health(name) {
  if (name === 'BCHN') {
    const info = await rpc('getblockchaininfo');
    // An intentionally idle private regtest chain can report IBD after a long VM shutdown.
    if (info.chain !== chain) throw Error('BCHN network mismatch');
    if (chip && (info.initialblockdownload || info.blocks !== info.headers)) throw Error('Chipnet synchronization in progress');
    if (chip && await rpc('getblockhash', [121957]) !== '0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78') throw Error('Chipnet fork mismatch');
  } else if (name === 'indexer') {
    const info = await json('http://127.0.0.1:3100/health');
    if (info.chain !== network || !info.health?.connected || !info.tip) throw Error('Indexer network mismatch or not synchronized');
  } else {
    const response = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !(await response.text()).includes('/@vite/client')) throw Error('Vite is not ready');
    await health('indexer');
    const info = await json('http://127.0.0.1:5173/api/health');
    if (!info.health?.connected) throw Error('Vite API proxy is not healthy');
  }
}
async function ready(name, record) {
  let lastError;
  for (let attempt = 0; attempt < (chip && name === 'BCHN' ? 7200 : 180); attempt++) {
    if (stopping) throw Error('Startup interrupted');
    if (record && !await alive(record)) throw Error(`${name} exited during startup. See ${directory}/${name}.log`);
    try { await health(name); return; } catch (error) { lastError = error; }
    await delay(500);
  }
  throw Error(`${name} did not become healthy: ${lastError}. See ${directory}/${name}.log; existing processes were left untouched.`);
}
async function start(name, port, executable, args, cwd = root) {
  if (await verifyListener(name, port)) {
    log(`Reusing ${name} on port ${port}; waiting for health…`);
    await ready(name);
    log(`${name} healthy (reused).`);
    return;
  }
  log(`Starting ${name}; log: ${directory}/${name}.log`);
  const file = await open(resolve(directory, `${name}.log`), 'a', 0o600);
  let child;
  try {
    child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', file.fd, file.fd] });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  } finally { await file.close(); }
  const record = { name, ...await identity(child.pid), owner: await identity(process.pid) };
  if (!record.pid) throw Error(`${name} exited immediately; see its log.`);
  owned.push(record);
  const state = await readState();
  state.push(record);
  await saveState(state);
  child.unref();
  await ready(name, record);
  await verifyListener(name, port);
  log(`${name} healthy (started PID ${record.pid}).`);
}
async function checkpointBusy(checkpoint) {
  const socket = createServer();
  try {
    await new Promise((done, reject) => {
      socket.once('error', reject);
      socket.listen('\0staking-arena-' + createHash('sha256').update(resolve(root, checkpoint)).digest('hex'), done);
    });
    await new Promise(done => socket.close(done));
    return false;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return true;
  }
}
async function terminate(record) {
  if (!await alive(record)) return;
  log(`Stopping ${record.name} (PID ${record.pid}) gracefully…`);
  process.kill(record.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 240; attempt++) {
    if (!await alive(record)) return;
    await delay(250);
  }
  throw Error(`${record.name} did not stop within 60 seconds; no SIGKILL was sent. Inspect PID ${record.pid}.`);
}
async function cleanup(all = false) {
  const unlock = await lock(false);
  try {
    const state = await readState();
    const targets = all ? state : owned;
    if (all) {
      for (const record of state) {
        if (record.owner && await alive(record.owner)) process.kill(record.owner.pid, 'SIGTERM');
      }
    }
    const failures = [];
    for (const name of ['Vite', 'indexer', 'BCHN']) {
      for (const record of targets.filter(record => record.name === name)) {
        try { await terminate(record); } catch (error) { failures.push(error.message); }
      }
    }
    const remaining = [];
    for (const record of state) if (await alive(record)) remaining.push(record);
    await saveState(remaining);
    if (failures.length) throw Error(failures.join('\n'));
  } finally { await unlock(); }
}
async function main() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.argv[2] === 'stop') {
    await cleanup(true);
    log('Managed development services stopped. Manually started services were left running.');
    return;
  }
  if (!['0.0.0.0', '127.0.0.1'].includes(host)) throw Error('FRONTEND_HOST must be 0.0.0.0 or 127.0.0.1');
  const unlock = await lock();
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if ((!chip && config.keeper !== false) || config.port !== 3100 || !Array.isArray(config.vaults) || (!chip && !config.vaults.length) || !config.checkpoint) {
      throw Error('Saved frontend config must contain vaults, checkpoint, keeper:false and port:3100. No config was changed.');
    }
    if (!chip) await readFile(resolve(root, config.checkpoint));
    await readFile(resolve(dataDirectory, 'bitcoin.conf'));
    await readFile(resolve(root, 'frontend/node_modules/vite/bin/vite.js'));
    const state = [];
    for (const record of await readState()) if (await alive(record)) state.push(record);
    await saveState(state);
    await start('BCHN', rpcPort, 'bitcoind', [
      `-datadir=${dataDirectory}`, chip ? '-chipnet' : '-regtest', '-daemon=0',
      '-rpcbind=127.0.0.1', '-rpcallowip=127.0.0.1', `-rpcport=${rpcPort}`,
      '-listen=0', ...(chip ? [] : ['-connect=0', '-dnsseed=0', '-discover=0', '-upnp=0', '-natpmp=0']),
    ]);
    if (!chip) await rpc('setnetworkactive', [false]);
    if (!(await rpc('listwallets')).includes(walletName)) {
      if (!(await rpc('listwalletdir')).wallets.some(wallet => wallet.name === walletName)) throw Error('Configured wallet is missing; initialize it explicitly.');
      await rpc('loadwallet', [walletName]);
      log('Loaded configured test wallet.');
    }
    if (!listeners(3100).length && await checkpointBusy(config.checkpoint)) {
      log('An indexer already owns this checkpoint. Waiting for its API; no duplicate will be started…');
      await ready('indexer');
    }
    await start('indexer', 3100, process.execPath, ['--import', 'tsx', 'scripts/arena.ts', configPath]);
    await start('Vite', 5173, process.execPath, [resolve(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', host], resolve(root, 'frontend'));
    log(`Ready: http://127.0.0.1:5173 (listening on ${host}:5173; Windows: use your existing QEMU forwarded port).`);
    log('Indexer: http://127.0.0.1:3100/health · frontend proxy: /api/health · BCHN RPC: localhost only.');
  } finally { await unlock(); }
  if (!owned.length) {
    log('All services already running; nothing new to supervise. Use npm run dev:stop for managed services.');
    return;
  }
  log('Ctrl+C stops only services started by this invocation. npm run dev:stop stops all launcher-managed services.');
  while (!stopping) {
    for (const record of owned) {
      if (!await alive(record)) throw Error(`${record.name} stopped unexpectedly. Run npm run dev again to recover; inspect ${directory}/${record.name}.log`);
    }
    await delay(500);
  }
}
try { await main(); }
catch (error) {
  if (!stopping) { console.error(`[arena] ${error.message}`); process.exitCode = 1; }
} finally {
  if (owned.length) {
    try { await cleanup(); log('Services started by this invocation have stopped.'); }
    catch (error) { console.error(`[arena] ${error.message}`); process.exitCode = 1; }
  }
}
