import { connect as tlsConnect } from 'node:tls';
import { connect as tcpConnect, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { Network, type NetworkProvider, type SpendableUtxo } from 'cashscript';

export const hash256 = (data: Uint8Array): Buffer => createHash('sha256').update(createHash('sha256').update(data).digest()).digest();
export const scriptHash = (script: string) => createHash('sha256').update(Buffer.from(script, 'hex')).digest().reverse().toString('hex');
export const headerHash = (hex: string) => hash256(Buffer.from(hex, 'hex')).reverse().toString('hex');
export interface Header { height: number; hex: string; hash: string; parent: string; time: number; merkle: string }
export interface HistoryEntry { tx_hash: string; height: number }
export interface ElectrumOptions { network?: 'chipnet' | 'mainnet'; endpoints?: string[]; timeoutMs?: number; maxTipAgeSeconds?: number }
export type ElectrumRequest = (method: string, ...params: (string | number | boolean)[]) => Promise<any>;
const isHash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function decodeRawTransaction(raw: string, expected?: string) {
  if (!/^(?:[a-f0-9]{2})+$/i.test(raw)) throw Error('Invalid raw transaction hex');
  const bytes = hexToBin(raw), tx = decodeTransaction(bytes), txid = hashTransaction(bytes);
  if (typeof tx === 'string' || (expected && expected !== txid)) throw Error('Invalid raw transaction or transaction ID mismatch');
  return { txid, hex: raw, vin: tx.inputs.map(i => ({ txid: binToHex(i.outpointTransactionHash), vout: i.outpointIndex, scriptSig: { hex: binToHex(i.unlockingBytecode) } })),
    vout: tx.outputs.map((o, n) => ({ n, satoshis: o.valueSatoshis.toString(), value: Number(o.valueSatoshis) / 1e8, scriptPubKey: { hex: binToHex(o.lockingBytecode) },
      ...(o.token ? { tokenData: { category: binToHex(o.token.category), amount: o.token.amount.toString(), ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } } : {}) })) };
}
/** Bounded JSON-lines transport. A failed session is discarded, never continued on another server. */
class Connection {
  socket?: Socket;
  sequence = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(readonly endpoint: string, readonly timeout: number) {}
  async connect() {
    const url = new URL(this.endpoint);
    if (!['ssl:', 'tcp:'].includes(url.protocol) || url.username || url.password || !url.port) throw Error('Electrum endpoint must be ssl://host:port or tcp://host:port');
    await new Promise<void>((resolve, reject) => {
      const socket = url.protocol === 'ssl:' ? tlsConnect({ host: url.hostname, port: Number(url.port), servername: url.hostname }) : tcpConnect({ host: url.hostname, port: Number(url.port) });
      this.socket = socket;
      const timer = setTimeout(() => { socket.destroy(); reject(Error('Electrum connect timeout')); }, this.timeout);
      socket.once(url.protocol === 'ssl:' ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(); });
      socket.on('error', e => { clearTimeout(timer); reject(e); this.close(e); });
      socket.on('close', () => this.close(Error('Electrum disconnected')));
      let buffer = '';
      socket.on('data', data => {
        buffer += data.toString();
        if (buffer.length > 16 * 1024 * 1024) { this.close(Error('Electrum response too large')); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const response = JSON.parse(line), pending = this.pending.get(response.id);
            if (!pending) continue;
            clearTimeout(pending.timer); this.pending.delete(response.id);
            if (response.error) pending.reject(Error(`Electrum ${JSON.stringify(response.error)}`)); else pending.resolve(response.result);
          } catch { this.close(Error('Malformed Electrum JSON')); }
        }
      });
    });
  }
  request: ElectrumRequest = async (method, ...params) => new Promise((resolve, reject) => {
    const id = ++this.sequence;
    const timer = setTimeout(() => this.close(Error(`Electrum timeout: ${method}`)), this.timeout);
    this.pending.set(id, { resolve, reject, timer });
    this.socket!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  close(error = Error('Electrum session closed')) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.socket?.destroy();
  }
}

/** Read adapter: raw bytes are authoritative for amounts/tokens, not verbose JSON numbers.
 * Sessions pin a server; failover retries the whole read snapshot. No automatic broadcasting.
 */
export class ElectrumProvider implements NetworkProvider {
  network = Network.CHIPNET;
  readonly endpoints: string[];
  readonly timeoutMs: number;
  readonly maxTipAgeSeconds: number;
  endpoint = '';
  request: ElectrumRequest = async () => { throw Error('Electrum operation requires a session'); };
  constructor(options: ElectrumOptions = {}) {
    if ((options.network ?? 'chipnet') !== 'chipnet') throw Error('Mainnet Electrum is disabled');
    this.endpoints = options.endpoints ?? (process.env.ARENA_ELECTRUM_ENDPOINTS ?? 'ssl://chipnet.bch.ninja:50002,ssl://chipnet.imaginary.cash:50002').split(',');
    this.timeoutMs = options.timeoutMs ?? Number(process.env.ARENA_ELECTRUM_TIMEOUT_MS ?? 10000);
    this.maxTipAgeSeconds = options.maxTipAgeSeconds ?? 21600;
    if (!this.endpoints.length || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100) throw Error('Invalid Electrum configuration');
  }
  private queue: Promise<unknown> = Promise.resolve();
  session<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.runSession(work));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async runSession<T>(work: () => Promise<T>): Promise<T> {
    const errors: string[] = [];
    for (const endpoint of this.endpoints) {
      const connection = new Connection(endpoint, this.timeoutMs);
      try {
        await connection.connect(); this.endpoint = endpoint; this.request = connection.request;
        const version = await this.request('server.version', 'Staking Arena', '1.5.0');
        if (!Array.isArray(version) || !/^1\.(?:[5-9]|[1-9][0-9])(?:\.|$)/.test(version[1])) throw Error('Electrum Cash protocol 1.5.0 required: ' + JSON.stringify(version));
        if ((await this.header(0)).hash !== '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b'
          || (await this.header(121957)).hash !== '0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78') throw Error('Electrum chipnet identity mismatch');
        return await work();
      } catch (e) { errors.push(`${endpoint}: ${String(e)}`); }
      finally { connection.close(); this.request = async () => { throw Error('Electrum session closed'); }; }
    }
    throw Error(errors.join('; '));
  }
  async header(height: number): Promise<Header> {
    if (!Number.isSafeInteger(height) || height < 0) throw Error('Invalid header height');
    const hex = await this.request('blockchain.block.header', height);
    if (typeof hex !== 'string' || !/^[0-9a-f]{160}$/.test(hex)) throw Error('Malformed Electrum header');
    const b = Buffer.from(hex, 'hex');
    return { height, hex, hash: headerHash(hex), parent: Buffer.from(b.subarray(4,36)).reverse().toString('hex'), merkle: Buffer.from(b.subarray(36,68)).reverse().toString('hex'), time: b.readUInt32LE(68) };
  }
  async tip() {
    const result = await this.request('blockchain.headers.subscribe');
    const header = await this.header(result.height);
    if (header.hex !== result.hex || Date.now()/1000 - header.time > this.maxTipAgeSeconds || header.time > Date.now()/1000 + 7200) throw Error('Stale or inconsistent Electrum tip');
    return header;
  }
  /** Link every relevant proof header to the selected tip, including gaps without vault activity. */
  async verifyHeaderChain(firstHeight: number, tip: Header, expected: Map<number, string>) {
    let previous: string | undefined;
    for (let start = firstHeight; start <= tip.height; start += 2016) {
      const count = Math.min(2016, tip.height-start+1);
      const result = await this.request('blockchain.block.headers', start, count);
      if (result.count !== count || typeof result.hex !== 'string' || !new RegExp(`^[0-9a-f]{${count*160}}$`).test(result.hex)) throw Error('Incomplete header range');
      for (let i = 0; i < count; i++) {
        const hex = result.hex.slice(i*160, (i+1)*160), bytes = Buffer.from(hex, 'hex'), hash = headerHash(hex);
        const parent = Buffer.from(bytes.subarray(4,36)).reverse().toString('hex'), height = start+i;
        if ((previous && parent !== previous) || (expected.has(height) && expected.get(height) !== hash) || (height === tip.height && hash !== tip.hash)) throw Error('Header chain mismatch');
        previous = hash;
      }
    }
  }
  async medianTime(height: number, expectedTipHash?: string) {
    const headers: Header[] = [];
    for (let n = Math.max(0, height-10); n <= height; n++) {
      const h = await this.header(n);
      if (headers.length && h.parent !== headers.at(-1)!.hash) throw Error('Inconsistent MTP headers');
      headers.push(h);
    }
    if (expectedTipHash && headers.at(-1)!.hash !== expectedTipHash) throw Error('MTP tip mismatch');
    return headers.map(h => h.time).sort((a,b) => a-b)[Math.floor(headers.length/2)]!;
  }
  async history(script: string): Promise<HistoryEntry[]> {
    if (!/^(?:[a-f0-9]{2})*$/i.test(script)) throw Error('Invalid locking script');
    const history = await this.request('blockchain.scripthash.get_history', scriptHash(script));
    if (!Array.isArray(history) || history.some(h => !isHash(h.tx_hash) || (!Number.isSafeInteger(h.height) || h.height < -1)) || new Set(history.map(h => h.tx_hash)).size !== history.length) throw Error('Malformed Electrum history');
    return history;
  }
  async getRawTransaction(txid: string): Promise<string> {
    if (!isHash(txid)) throw Error('Invalid transaction ID');
    const raw = await this.request('blockchain.transaction.get', txid, false);
    decodeRawTransaction(raw, txid); return raw;
  }
  async transaction(txid: string, height?: number): Promise<any> {
    const tx = decodeRawTransaction(await this.getRawTransaction(txid), txid);
    if (height === undefined || height <= 0) return { ...tx, confirmations: 0 };
    const proof = await this.request('blockchain.transaction.get_merkle', txid, height), header = await this.header(height);
    if (proof.block_height !== height || !Number.isSafeInteger(proof.pos) || proof.pos < 0 || !Array.isArray(proof.merkle) || proof.merkle.length > 32 || proof.merkle.some((s: any) => !isHash(s))) throw Error('Invalid transaction proof');
    let hash: Buffer = Buffer.from(txid, 'hex').reverse();
    let position = proof.pos;
    for (const sibling of proof.merkle) {
      const other = Buffer.from(sibling, 'hex').reverse();
      hash = hash256(Buffer.concat(position % 2 ? [other, hash] : [hash, other])); position = Math.floor(position/2);
    }
    if (position !== 0 || Buffer.from(hash).reverse().toString('hex') !== header.merkle) throw Error('Transaction Merkle proof mismatch');
    return { ...tx, confirmations: 1, blockhash: header.hash, height };
  }
  async transactionStatus(txid: string) {
    const tx = await this.transaction(txid);
    // A raw transaction lookup does not prove confirmation. Locate it through one of its output scripts.
    if (!tx.vout.length) throw Error('Transaction has no outputs');
    const entry = (await this.history(tx.vout[0].scriptPubKey.hex)).find(h => h.tx_hash === txid);
    if (!entry) throw Error('Transaction status unavailable');
    const tip = await this.tip();
    if (entry.height > tip.height) throw Error('Transaction confirmation ahead of tip');
    const confirmed = await this.transaction(txid, entry.height);
    if (entry.height > 0) await this.verifyHeaderChain(entry.height, tip, new Map([[entry.height, confirmed.blockhash]]));
    if ((await this.tip()).hash !== tip.hash) throw Error('Tip changed during transaction lookup');
    return { ...confirmed, confirmations: entry.height > 0 ? tip.height - entry.height + 1 : 0 };
  }
  async getBlockHeight() { return (await this.tip()).height; }
  async getUtxos(address: string) {
    const result = cashAddressToLockingBytecode(address);
    if (typeof result === 'string' || result.prefix !== 'bchtest') throw Error('Address network mismatch');
    return this.getUtxosForLockingBytecode(result.bytecode);
  }
  async getUtxosForLockingBytecode(script: string | Uint8Array): Promise<SpendableUtxo[]> {
    const hex = typeof script === 'string' ? script : binToHex(script);
    if (!/^(?:[a-f0-9]{2})*$/i.test(hex)) throw Error('Invalid locking script');
    const rows = await this.request('blockchain.scripthash.listunspent', scriptHash(hex), 'include_tokens');
    if (!Array.isArray(rows)) throw Error('Malformed Electrum UTXOs');
    const outputs: SpendableUtxo[] = [];
    for (const row of rows) {
      if (!isHash(row.tx_hash) || !Number.isSafeInteger(row.tx_pos) || row.tx_pos < 0 || !Number.isSafeInteger(row.height)) throw Error('Malformed UTXO outpoint');
      const tx = await this.transaction(row.tx_hash, row.height), o = tx.vout[row.tx_pos];
      if (!o || o.scriptPubKey.hex !== hex || !Number.isSafeInteger(row.value) || BigInt(row.value) !== BigInt(o.satoshis)) throw Error('Electrum UTXO mismatch');
      outputs.push({ txid: tx.txid, vout: row.tx_pos, satoshis: BigInt(o.satoshis), lockingBytecode: hex,
        ...(o.tokenData ? { token: { category: o.tokenData.category, amount: BigInt(o.tokenData.amount), ...(o.tokenData.nft ? { nft: o.tokenData.nft } : {}) } } : {}) });
    }
    return outputs;
  }
  async sendRawTransaction(_hex: string): Promise<string> { throw Error('Electrum broadcasting disabled in read-only phase'); }
}
