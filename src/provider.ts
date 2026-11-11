import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { Network, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { rpc, assertNetwork, networkConfig } from './rpc.js';
/** Small-chain development provider. Scans are serialized by callers; not an address indexer.
 * BCH-only: token outputs fail explicitly rather than risking accidental token burns.
 */
export class BchnProvider implements NetworkProvider {
  network = networkConfig().network === 'chipnet' ? Network.CHIPNET : Network.REGTEST;
  async getBlockHeight(): Promise<number> { await assertNetwork(); return rpc('getblockcount'); }
  async getRawTransaction(txid: string): Promise<string> { await assertNetwork(); return rpc('getrawtransaction', [txid]); }
  async sendRawTransaction(hex: string): Promise<string> { await assertNetwork(); return rpc('sendrawtransaction', [hex]); }
  async getUtxos(address: string) {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string' || decoded.prefix !== networkConfig().prefix) throw new Error('Address network mismatch');
    return this.getUtxosForLockingBytecode(decoded.bytecode);
  }
  async getUtxosForLockingBytecode(bytecode: string | Uint8Array): Promise<SpendableUtxo[]> {
    await assertNetwork();
    const script = typeof bytecode === 'string' ? bytecode : binToHex(bytecode);
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(script)) throw new Error('Invalid locking bytecode');
    const scan = await rpc('scantxoutset', ['start', [`raw(${script})`]]);
    if (!scan.success) throw new Error('UTXO scan failed');
    const candidates = scan.unspents.map((u: any) => ({ txid: u.txid, vout: u.vout }));
    for (const txid of await rpc<string[]>('getrawmempool')) {
      const tx = await rpc('getrawtransaction', [txid, true]);
      for (const out of tx.vout) if (out.scriptPubKey.hex === script) candidates.push({ txid, vout: out.n });
    }
    const result: SpendableUtxo[] = [];
    for (const u of candidates) {
      const out = await rpc('gettxout', [u.txid, u.vout, true]);
      if (!out) continue;
      if (out.tokenData) throw new Error('CashTokens are not supported by this BCH-only development adapter');
      result.push({ ...u, satoshis: BigInt(Math.round(out.value * 1e8)), lockingBytecode: script });
    }
    return result;
  }
}

/** Retained name for reference tests. Select ARENA_NETWORK=regtest explicitly. */
export class RegtestProvider extends BchnProvider {}
