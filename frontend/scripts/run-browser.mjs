// Timestamped evidence lives outside Playwright's cleaned output directory.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL(`../browser-diagnostics/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url));
mkdirSync(dir, { recursive: true });
console.log(`Browser diagnostics: ${dir}`);
function sample() {
  const record = { time: new Date().toISOString() };
  try {
    record.meminfo = readFileSync('/proc/meminfo', 'utf8');
    record.vmstat = readFileSync('/proc/vmstat', 'utf8').split('\n').filter(line => /^(pswp|oom_kill|pgmajfault)/.test(line));
    record.pressure = readFileSync('/proc/pressure/memory', 'utf8');
    record.processes = [];
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        if (/^Name:\s*(chrome|chromium|headless|node|vite|MainThread|npm)/m.test(status)) {
          record.processes.push(status.split('\n').filter(line => /^(Name|Pid|PPid|VmRSS|VmSwap|Threads):/.test(line)));
        }
      } catch { /* Processes can exit between enumeration and reading. */ }
    }
  } catch { /* Linux measurements are optional on other platforms. */ }
  appendFileSync(`${dir}/memory.jsonl`, JSON.stringify(record) + '\n');
}
sample();
const timer = setInterval(sample, 5000);
const args = process.argv.slice(2);
const child = spawn(process.execPath, args[0] === '--script' ? args.slice(1) : [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test', ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, ARENA_DIAGNOSTICS_DIR: dir, DEBUG: [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(',') },
});
for (const [stream, target, filename] of [[child.stdout, process.stdout, 'runner.log'], [child.stderr, process.stderr, 'chromium.log']]) {
  stream.on('data', data => { target.write(data); appendFileSync(`${dir}/${filename}`, data); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); clearInterval(timer); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  clearInterval(timer); sample();
  // Kernel evidence distinguishes an OOM kill from a selector or renderer failure.
  const kernel = spawn('journalctl', ['-k', '--since', '15 minutes ago', '--no-pager'], { stdio: ['ignore', 'pipe', 'ignore'] });
  kernel.on('error', () => {});
  kernel.stdout.on('data', data => appendFileSync(`${dir}/kernel.log`, data));
  appendFileSync(`${dir}/runner.log`, `\nExit: ${code}, signal: ${signal}\n`);
  process.exitCode = code ?? 1;
});
