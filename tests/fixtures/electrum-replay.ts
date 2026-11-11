import { readFile } from 'node:fs/promises';
import { ElectrumProvider, decodeRawTransaction, scriptHash, type ElectrumOptions } from '../../src/electrum.js';
export const fixture = JSON.parse(await readFile(new URL('./electrum-chipnet.json', import.meta.url), 'utf8'));
const key = (method: string, ...params: unknown[]) => JSON.stringify([method,...params]);
export const headers = new Map<number, string>();
for (const [k,v] of Object.entries(fixture.responses)) {
  const [method,start] = JSON.parse(k);
  if (method === 'blockchain.block.header') headers.set(start,v as string);
  if (method === 'blockchain.block.headers') {
    const result = v as {hex:string;count:number};
    for (let i=0;i<result.count;i++) headers.set(start+i,result.hex.slice(i*160,(i+1)*160));
  }
}
const raw = new Map<string, string>();
export const heights = new Map<string, number>();
for (const [k,v] of Object.entries(fixture.responses)) {
  const [method,id,height] = JSON.parse(k);
  if (method === 'blockchain.transaction.get') raw.set(id,v as string);
  if (method === 'blockchain.transaction.get_merkle') heights.set(id,height);
}
export class Replay extends ElectrumProvider {
  height = fixture.expected.tip.height;
  fail = '';
  corruptProof = false;
  corruptHeader = false;
  reverseHistory = false;
  pending = false;
  cutoff?: number;
  omit?: string;
  forks = new Map<number,string>();
  getHeader(height: number) { return this.forks.get(height) ?? headers.get(height); }
  constructor(options: ElectrumOptions = {}) { super({maxTipAgeSeconds: Number.MAX_SAFE_INTEGER, ...options}); this.endpoint = 'fixture://captured-chipnet'; }
  override async session<T>(work: () => Promise<T>): Promise<T> { return work(); }
  override request = async (method: string, ...params: (string|number|boolean)[]): Promise<any> => {
    if (this.fail) throw Error(this.fail);
    if (method === 'server.version') return ['Fulcrum fixture','1.5'];
    if (method === 'blockchain.headers.subscribe') return {height:this.height,hex:this.getHeader(this.height)};
    if (method === 'blockchain.block.header') return this.getHeader(Number(params[0]));
    if (method === 'blockchain.block.headers') {
      const hex = Array.from({length:Number(params[1])},(_,i)=>this.getHeader(Number(params[0])+i)).join('');
      return {count:params[1],hex:this.corruptHeader ? '00'+hex.slice(2) : hex};
    }
    const response = structuredClone(fixture.responses[key(method,...params)]);
    if (response === undefined && !(method === 'blockchain.scripthash.listunspent' && (this.cutoff ?? this.height) < fixture.expected.tip.height)) throw Error(`Unrecorded fixture request ${key(method,...params)}`);
    if (method === 'blockchain.scripthash.get_history') {
      const filtered = response.filter((r:any)=>r.height<=(this.cutoff ?? this.height) && r.tx_hash !== this.omit);
      if (this.pending) filtered.push({tx_hash:'ab'.repeat(32),height:0});
      return this.reverseHistory ? filtered.reverse() : filtered;
    }
    if (method === 'blockchain.scripthash.listunspent' && (this.cutoff ?? this.height) < fixture.expected.tip.height) {
      // Derive the UTXO set before the rollback boundary, including outputs later spent.
      const txs = [...raw].filter(([id])=>(heights.get(id)??Infinity)<=(this.cutoff ?? this.height)).map(([id,hex])=>decodeRawTransaction(hex,id));
      const spent = new Set(txs.flatMap(tx=>tx.vin.map(i=>`${i.txid}:${i.vout}`)));
      return txs.flatMap(tx=>tx.vout.filter(o=>scriptHash(o.scriptPubKey.hex)===params[0]&&!spent.has(`${tx.txid}:${o.n}`)).map(o=>({tx_hash:tx.txid,tx_pos:o.n,height:heights.get(tx.txid),value:Number(o.satoshis)})));
    }
    if (method === 'blockchain.transaction.get_merkle' && this.corruptProof) response.merkle = ['00'.repeat(32)];
    return response;
  };
}

