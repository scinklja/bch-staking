// Test-only file server: no Vite middleware, proxy, API or backend process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const configured = resolve('.static-test/api');
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const base = path.startsWith('/configured/') ? configured : root;
  const relative = base === configured ? path.slice('/configured/'.length) : path.slice(1);
  const file = resolve(base, relative || 'index.html');
  if (!file.startsWith(base + '/')) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(file);
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4174, '127.0.0.1');
