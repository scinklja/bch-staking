import { vaultView } from './view.js';
export { vaultView } from './view.js';
import { cors } from './http-policy.js';
import { rpc, assertNetwork } from './rpc.js';
import { walletApi } from './wallet-api.js';
import type { VaultConfig } from './arena.js';
import { networkConfig } from './rpc.js';
import { createServer } from 'node:http';
import { Indexer } from './indexer.js';
import { json } from './arena.js';

export function api(index: Indexer, saveVault?: (config: VaultConfig) => Promise<void>) {
  const wallets = walletApi(index, saveVault);
  return createServer(async (req, res) => {
    if (cors(req,res)) return;
    if (!index.electrum && await wallets(req, res)) return;
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    const send = (status: number, body: unknown) => { res.writeHead(status); res.end(json(body)); };
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); send(405, { error: 'Read-only API' }); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
    const stale = index.health.stale || !index.health.updatedAt || Date.now() - Date.parse(index.health.updatedAt) > 60000;
    const health = { ...index.health, stale };
    const meta = { chain: networkConfig().network, health, tip: index.tip ? { height: index.tip.height, hash: index.tip.hash, mtp: index.tip.mtp } : null, confirmedOnly: true };
    if (path.length === 1 && path[0] === 'health') { send(index.health.connected && !stale ? 200 : 503, meta); return; }
    if(path.length===2&&path[0]==='transactions'&&/^[0-9a-f]{64}$/i.test(path[1]!)) {
      if (index.electrum) {
        try {
          const tx = await index.electrum.session(() => index.electrum!.transactionStatus(path[1]!));
          send(200, { chain: networkConfig().network, txid: path[1], status: tx.confirmations > 0 ? 'confirmed' : 'pending', confirmations: tx.confirmations, block: tx.blockhash ?? null });
        } catch { send(503, { status: 'unavailable', error: 'Electrum transaction lookup unavailable' }); }
        return;
      }
      try { await assertNetwork(true); } catch { send(503,{status:'unavailable',error:'Blockchain data unavailable'});return; }
      try {
        const tx=await rpc('getrawtransaction',[path[1],true]);
        const confirmations=tx.confirmations??0;
        send(200,{chain:networkConfig().network,txid:path[1],status:confirmations>0?'confirmed':confirmations<0?'orphaned':'pending',confirmations,block:tx.blockhash??null});
      }catch (error) {if(!String(error).includes('\"code\":-5')){send(503,{status:'unavailable',error:'Transaction lookup unavailable'});return;}send(404,{chain:networkConfig().network,txid:path[1],status:'not-found',error:'Not observed on this node; may be dropped, reorganized or unavailable. Retry after synchronization.'});}
      return;
    }
    if (path[0] !== 'vaults') { send(404, { error: 'Not found' }); return; }
    if (path.length === 1) { send(200, { ...meta, vaults: index.vaults.map(v => vaultView(index, v.category)) }); return; }
    const view = vaultView(index, path[1]!);
    if (!view) { send(404, { error: 'Vault not indexed' }); return; }
    const endpoints = ['offers', 'rankings', 'periods', 'allocations', 'withdrawals', 'history'] as const;
    const endpoint = endpoints.find(e => e === path[2]);
    if (path.length > 2 && (path.length !== 3 || !endpoint)) { send(404, { error: 'Not found' }); return; }
    send(200, { ...meta, data: endpoint ? view[endpoint] : view });
  });
}
