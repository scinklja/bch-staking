import { binToHex } from '@bitauth/libauth';
import { type SpendableUtxo } from 'cashscript';
import { RegtestProvider } from './provider.js';
import { rpc, assertRegtest } from './rpc.js';
/** Explicit opt-in token-aware adapter; leaves the original BCH-only adapter unchanged. */
export class TokenRegtestProvider extends RegtestProvider {
  override async getUtxosForLockingBytecode(bytecode: string | Uint8Array): Promise<SpendableUtxo[]> {
    await assertRegtest();
    const script = typeof bytecode === 'string' ? bytecode : binToHex(bytecode);
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(script)) throw Error('Invalid locking bytecode');
    const scan = await rpc('scantxoutset', ['start', [`raw(${script})`]]);
    if (!scan.success) throw Error('UTXO scan failed');
    const candidates = scan.unspents.map((u: any) => ({ txid: u.txid, vout: u.vout }));
    for (const txid of await rpc<string[]>('getrawmempool')) {
      const tx = await rpc('getrawtransaction', [txid, true]);
      for (const out of tx.vout) if (out.scriptPubKey.hex === script) candidates.push({ txid, vout: out.n });
    }
    const result: SpendableUtxo[] = [];
    for (const u of candidates) {
      const out = await rpc('gettxout', [u.txid, u.vout, true]);
      if (!out) continue;
      const token = out.tokenData;
      result.push({ ...u, satoshis: BigInt(Math.round(out.value * 1e8)), lockingBytecode: script,
        ...(token ? { token: { category: token.category, amount: BigInt(token.amount ?? 0),
          ...(token.nft ? { nft: { capability: token.nft.capability, commitment: token.nft.commitment } } : {}) } } : {}) });
    }
    return result;
  }
}
