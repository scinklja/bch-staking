import type { IncomingMessage, ServerResponse } from 'node:http';
export function allowedOrigins() {
  return (process.env.ARENA_UI_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s=>s.trim()).filter(Boolean);
}
export function trustedOrigin(origin: string | undefined) { return !!origin && allowedOrigins().includes(origin); }
export function cors(req: IncomingMessage,res: ServerResponse) {
  res.setHeader('vary','Origin');
  if(trustedOrigin(req.headers.origin)) {
    res.setHeader('access-control-allow-origin',req.headers.origin!);
    res.setHeader('access-control-allow-methods','GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers','Content-Type, X-Arena-Network');
  }
  if(req.method==='OPTIONS') { res.writeHead(trustedOrigin(req.headers.origin)?204:403);res.end();return true; }
  return false;
}
