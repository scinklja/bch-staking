// Test-only static server. Optional live check forwards only GET /api/vaults to the existing read-only loopback indexer; no backend process starts.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const configured = resolve('.static-test/api');
const live = resolve('.static-test/live');
const electrum = resolve('.static-test/electrum');
export const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/vaults' && process.env.ARENA_TEST_API) {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    try {
      const upstream = await fetch(process.env.ARENA_TEST_API + '/vaults', { cache:'no-store', signal:AbortSignal.timeout(10000) });
      res.writeHead(upstream.status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(await upstream.text());
    } catch { res.writeHead(503).end(); }
    return;
  }
  const base = path.startsWith('/electrum/') ? electrum : path.startsWith('/configured/') ? configured : path.startsWith('/live/') ? live : root;
  const relative = base === electrum ? path.slice('/electrum/'.length) : base === configured ? path.slice('/configured/'.length) : base === live ? path.slice('/live/'.length) : path.slice(1);
  const file = resolve(base, relative || 'index.html');
  if (!file.startsWith(base + '/')) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(file);
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.ARENA_STATIC_PORT ?? 4174), '127.0.0.1', done);
});
