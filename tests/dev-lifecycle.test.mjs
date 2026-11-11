// Opt-in integration test against the saved local regtest environment. Never mines.
// Run with no development services running: npm run test:dev
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, FRONTEND_HOST: '0.0.0.0', PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };
delete env.ARENA_SPONSOR_KEY;
const directory = resolve(root, '.regtest/dev');
const statePath = resolve(directory, 'services.json');
const children = [];
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, description) {
  for (let attempt = 0; attempt < 480; attempt++) {
    if (await check()) return;
    await pause(250);
  }
  throw Error(`Timed out: ${description}`);
}
function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', data => { child.output += data; });
  child.stderr.on('data', data => { child.output += data; });
  child.done = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  children.push(child);
  return child;
}
async function ready(child) {
  await until(() => {
    if (child.exitCode !== null && child.exitCode !== 0) throw Error(child.output);
    return child.output.includes('[arena] Ready:');
  }, 'launcher readiness');
}
async function exited(child, code) {
  await until(() => child.exitCode !== null || child.signalCode !== null, `process ${child.pid} exit (${child.output})`);
  const result = await child.done;
  assert.equal(result.code, code, child.output);
}
const state = async () => JSON.parse(await readFile(statePath, 'utf8'));
function alive(pid) {
  try { return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).startsWith('Z'); }
  catch { return false; }
}
async function stopped(records) {
  await until(() => records.every(record => !alive(record.pid)), 'all owned services stopped');
}
async function stop() {
  const command = run(['scripts/dev.mjs', 'stop']);
  await exited(command, 0);
}
async function checkApi() {
  for (const url of ['http://127.0.0.1:3100/health', 'http://127.0.0.1:5173/api/health']) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.health.connected, true);
    assert.equal(body.tip.hash, baselineHash);
  }
}
for (const port of [18443, 3100, 5173]) {
  assert.equal(execFileSync('ss', ['-H', '-lnt', `sport = :${port}`], { encoding: 'utf8' }).trim(), '',
    `Port ${port} must be free. Stop services yourself before this opt-in test.`);
}
await mkdir(directory, { recursive: true, mode: 0o700 });
const configBefore = await readFile(resolve(root, '.regtest/frontend/config.json'), 'utf8');
const config = JSON.parse(configBefore);
const checkpointBefore = JSON.parse(await readFile(config.checkpoint, 'utf8'));
const baselineHash = checkpointBefore.blocks.at(-1).hash;
let manualNode, manualIndexer, collision;
try {
  // A previous boot can reuse both a PID and its start tick; boot identity must also match.
  const unrelated = run(['-e', 'setInterval(() => {}, 1000)']);
  const stat = await readFile(`/proc/${unrelated.pid}/stat`, 'utf8');
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  await writeFile(statePath, JSON.stringify([{ name: 'Vite', pid: unrelated.pid, start, boot: 'previous-boot' }]));
  await stop();
  assert.ok(alive(unrelated.pid));
  assert.deepEqual(await state(), []);
  unrelated.kill('SIGTERM');
  console.log('PASS stale process records from a previous boot cannot stop an unrelated process');

  // Race two cold starts. One supervisor owns the services; the other reuses them.
  const first = run(['scripts/dev.mjs']);
  const second = run(['scripts/dev.mjs']);
  await Promise.all([ready(first), ready(second)]);
  const records = await state();
  assert.deepEqual(records.map(record => record.name), ['BCHN', 'indexer', 'Vite']);
  const owner = records[0].owner.pid === first.pid ? first : second;
  const observer = owner === first ? second : first;
  await exited(observer, 0);
  assert.match(observer.output, /All services already running/);
  const repeated = run(['scripts/dev.mjs']);
  await exited(repeated, 0);
  assert.deepEqual(await state(), records);
  await checkApi();
  owner.kill('SIGINT');
  await exited(owner, 0);
  await stopped(records);
  console.log('PASS cold startup, concurrent/repeated startup, Ctrl+C of all owned services');

  // Test ownership with real, manually started BCHN and indexer processes.
  const nodeLog = await open(resolve(directory, 'test-manual-node.log'), 'a', 0o600);
  manualNode = spawn('bitcoind', [`-datadir=${resolve(root, '.regtest')}`, '-regtest', '-daemon=0'],
    { cwd: root, env, detached: true, stdio: ['ignore', nodeLog.fd, nodeLog.fd] });
  await nodeLog.close();
  await until(() => execFileSync('ss', ['-H', '-lnt', 'sport = :18443'], { encoding: 'utf8' }).trim(), 'manual BCHN');
  manualIndexer = run(['--import', 'tsx', 'scripts/arena.ts', resolve(root, '.regtest/frontend/config.json')]);
  await until(async () => {
    try { return (await fetch('http://127.0.0.1:3100/health')).ok; } catch { return false; }
  }, 'manual indexer health');
  const mixed = run(['scripts/dev.mjs']);
  await ready(mixed);
  assert.deepEqual((await state()).map(record => record.name), ['Vite']);
  mixed.kill('SIGINT');
  await exited(mixed, 0);
  assert.ok(alive(manualNode.pid) && alive(manualIndexer.pid));
  await stop();
  await stop();
  assert.ok(alive(manualNode.pid) && alive(manualIndexer.pid));
  manualIndexer.kill('SIGTERM');
  await exited(manualIndexer, 0);
  manualNode.kill('SIGTERM');
  await until(() => !alive(manualNode.pid), 'manual node graceful shutdown');
  console.log('PASS Ctrl+C and idempotent dev:stop preserve manually started BCHN/indexer');

  for (const name of ['indexer', 'Vite', 'BCHN']) {
    const launcher = run(['scripts/dev.mjs']);
    await ready(launcher);
    const running = await state();
    process.kill(running.find(record => record.name === name).pid, name === 'indexer' ? 'SIGKILL' : 'SIGTERM');
    await exited(launcher, 1);
    await stopped(running);
    const recovery = run(['scripts/dev.mjs']);
    await ready(recovery);
    await checkApi();
    await stop();
    await exited(recovery, 0);
    assert.deepEqual(await state(), []);
    console.log(`PASS recovery after ${name} interruption, graceful dev:stop`);
  }

  collision = createServer();
  await new Promise(done => collision.listen(5173, '127.0.0.1', done));
  const conflict = run(['scripts/dev.mjs']);
  await exited(conflict, 1);
  assert.match(conflict.output, /port 5173 is bound/);
  assert.ok(collision.listening);
  assert.deepEqual(await state(), []);
  console.log('PASS port conflict fails usefully, preserves unrelated listener and cleans owned services');

  assert.equal(await readFile(resolve(root, '.regtest/frontend/config.json'), 'utf8'), configBefore);
  assert.deepEqual(JSON.parse(await readFile(config.checkpoint, 'utf8')), checkpointBefore);
  console.log('PASS saved config and complete checkpoint unchanged; chain tip unchanged; no blocks or vaults created');
} catch (error) {
  for (const child of children) console.error(`Process ${child.pid}:\n${child.output}`);
  throw error;
} finally {
  if (collision?.listening) await new Promise(done => collision.close(done));
  // Interrupt supervisors that may still be waiting for readiness before taking the stop lock.
  for (const child of children) {
    if (child.pid && alive(child.pid)) child.kill('SIGTERM');
  }
  await stop();
  for (const child of [...children, manualIndexer, manualNode]) {
    if (child?.pid && alive(child.pid)) child.kill('SIGTERM');
  }
}
