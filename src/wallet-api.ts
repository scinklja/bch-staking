import { trustedOrigin } from './http-policy.js';
import { recordChipnetBroadcast } from './chain-evidence.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { decodeTransaction, hexToBin, binToHex } from '@bitauth/libauth';
import { Indexer } from './indexer.js';
import { assertNetwork, networkConfig, rpc } from './rpc.js';
import { createVaultPlan, createVaultGenesis, makeOfferPlan, prepareOfferFunding, submitWalletPlan, walletInput, withdrawAllocationPlan, type WalletPlan } from './transactions.js';
import { json, type VaultConfig } from './arena.js';
import { verifyRegistryGenesis } from './genesis.js';

/** Local intent API: no private keys and no arbitrary RPC forwarding. Browser writes require a
 * custom header and same-origin request; no CORS permission is granted. Plans live only in memory. */
export function walletApi(index: Indexer, saveVault?: (config: VaultConfig) => Promise<void>) {
  const pending = new Map<string, { plan: WalletPlan; created: number }>();
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/transactions/') || req.method === 'GET') return false;
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(json(data)); };
    try {
      if (networkConfig().network !== 'chipnet') throw Error('Wallet writes are chipnet-only');
      if (req.method !== 'POST' || req.headers['x-arena-network'] !== 'chipnet' || !req.headers['content-type']?.startsWith('application/json')) throw Error('Expected chipnet JSON intent');
      const origin = req.headers.origin;
      if (!trustedOrigin(origin)) throw Error('Untrusted browser origin');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 150000) throw Error('Intent too large'); }
      const data = JSON.parse(body);
      await assertNetwork(true);
      for (const [id,p] of pending) if (Date.now()-p.created > 600000) pending.delete(id);
      if (pathname === '/transactions/submit') {
        const item = pending.get(data.id);
        if (!item) throw Error('Plan expired or unknown');
        const result = await submitWalletPlan(item.plan,data.signedTransaction);
        await recordChipnetBroadcast(item.plan.label,result.txid);
        pending.delete(data.id); send(200,result); return true;
      }
      if (pathname === '/transactions/genesis') {
        const candidate = await createVaultGenesis(data.parameters,data.pregenesis);
        const txid = await rpc<string>('sendrawtransaction',[candidate.raw]);
        await recordChipnetBroadcast('vault-genesis',txid);
        send(200,{ status: 'broadcast', txid }); return true;
      }
      if (pathname === '/transactions/admit') {
        const config: VaultConfig = data.config;
        const verified = await verifyRegistryGenesis(config.genesis,config);
        if (!index.configs.some(c=>c.genesis===config.genesis)) {
          await saveVault?.(config);
          index.configs.push(config);
          index.blocks=[]; // rebuild from earliest pinned genesis
        }
        await index.sync(); send(200,{ status:'confirmed',...verified }); return true;
      }
      if (pathname !== '/transactions/plan') throw Error('Unknown intent endpoint');
      if (pending.size >= 16) throw Error('Too many pending wallet plans');
      const key = hexToBin(data.publicKey);
      let plan: WalletPlan;
      if (data.kind === 'withdraw') {
        const allocation = index.vaults.flatMap(v=>v.allocations).find(a=>a.id===data.allocation);
        if (!allocation) throw Error('Unknown allocation');
        plan = await withdrawAllocationPlan(allocation,key);
      } else {
        const input = await walletInput(data.funding.txid,data.funding.vout,key);
        if (data.kind==='create') plan = await createVaultPlan(data.parameters,input,key,BigInt(data.reserve));
        else if (data.kind==='prepare-offer') plan = await prepareOfferFunding(input,key,BigInt(data.amount));
        else if (data.kind==='offer') {
          await index.sync();
          const vault = index.vaults.find(v=>v.category===data.category);
          if (!vault) throw Error('Unknown vault');
          plan = await makeOfferPlan(vault,input,key,data.terms);
        } else throw Error('Unknown transaction kind');
      }
      // All signing source outputs must still exist on this synchronized chipnet node.
      const tx = plan.request.transaction;
      for (const input of tx.inputs) {
        if (!await rpc('gettxout',[binToHex(input.outpointTransactionHash),input.outpointIndex,true])) throw Error('Plan contains spent or non-chipnet input');
      }
      const id = randomUUID(); pending.set(id,{ plan,created:Date.now() });
      // WizardConnect uses libauth objects. Encode typed arrays and BigInts explicitly across JSON.
      const wire = JSON.parse(JSON.stringify(plan,(_,v)=>typeof v==='bigint'?{bigint:v.toString()}:v instanceof Uint8Array?{bytes:binToHex(v)}:v));
      send(200,{ id,network:'chipnet',genesis:networkConfig().genesis,plan:wire });
    } catch (error) { send(400,{error:String(error)}); }
    return true;
  };
}
