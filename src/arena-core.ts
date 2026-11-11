import { Buffer } from './bytes.js';
import Registry from '../artifacts/Registry.json' with { type: 'json' };
import RegistryGenesis from '../artifacts/RegistryGenesis.json' with { type: 'json' };
import StakePool from '../artifacts/StakePool.json' with { type: 'json' };
import StakeAllocation from '../artifacts/StakeAllocation.json' with { type: 'json' };
import { Contract, type SpendableUtxo, type NetworkProvider } from 'cashscript';
import { decodeAuthenticationInstructions } from '@bitauth/libauth';
import { satoshis } from './amount.js';
import type { GenesisParameters } from './genesis-core.js';
import { LIVE, SNAPSHOT, RECORD_SIZE, STATE_SIZE, allocationTerms, periodBoundary } from './registry.js';

export interface VaultConfig extends GenesisParameters { genesis: string }
const artifacts = { Registry, RegistryGenesis, StakePool, StakeAllocation };
export async function contract(name: string, args: (bigint | Uint8Array)[], networkProvider: NetworkProvider) {
  return new Contract(artifacts[name as keyof typeof artifacts], args,
    { provider: networkProvider, contractType: 'p2sh32' });
}
export async function contracts(config: VaultConfig, category: string, networkProvider: NetworkProvider) {
  const vault = Buffer.from(category, 'hex').reverse(), asset = Buffer.from(config.stakingCategory, 'hex').reverse();
  return { registry: await contract('Registry', [vault, asset, BigInt(config.epoch), BigInt(config.periodSeconds), BigInt(config.periods), BigInt(config.cap)], networkProvider),
    pool: await contract('StakePool', [Buffer.concat([vault, asset])], networkProvider) };
}
export function utxo(tx: any, n: number): SpendableUtxo {
  const o = tx.vout[n];
  return { txid: tx.txid, vout: n, satoshis: satoshis(o), lockingBytecode: o.scriptPubKey.hex,
    ...(o.tokenData ? { token: { category: o.tokenData.category, amount: BigInt(o.tokenData.amount ?? 0), ...(o.tokenData.nft ? { nft: o.tokenData.nft } : {}) } } : {}) };
}
export function records(state: Buffer, snapshot = false) {
  return Array.from({ length: state[5]! }, (_, slot) => {
    const start = (snapshot ? SNAPSHOT : LIVE) + slot * RECORD_SIZE, r = state.subarray(start, start + RECORD_SIZE);
    return { slot, owner: r.subarray(0, 33).toString('hex'), stake: r.readUInt32LE(33), duration: r.readUInt32LE(37),
      reward: r.readUInt32LE(41), maxWins: r[45]!, wins: r[46]!, cancelled: !!r[47], refunded: !!r[48] };
  });
}
export function rankings(state: Buffer, snapshot = state[4] === 1) {
  return records(state, snapshot).filter(r => !r.cancelled && !r.refunded && r.wins < r.maxWins).sort((a,b) => {
    const left = BigInt(a.stake) * BigInt(a.duration) * BigInt(b.reward);
    const right = BigInt(b.stake) * BigInt(b.duration) * BigInt(a.reward);
    return left === right ? a.slot - b.slot : left > right ? -1 : 1;
  });
}
/** CashScript pushes function arguments in reverse order, followed by the redeem script. */
export function transitionWitness(hex: string) {
  const pushes = decodeAuthenticationInstructions(Buffer.from(hex, 'hex')).map(i => {
    if ('data' in i && i.data) return Buffer.from(i.data);
    if (i.opcode === 0) return Buffer.alloc(0);
    if (i.opcode >= 81 && i.opcode <= 96) return Buffer.from([i.opcode - 80]);
    throw Error('Non-push or malformed registry unlocking script');
  });
  if (pushes.length !== 6 || pushes[4]!.length !== STATE_SIZE) throw Error('Invalid registry witness layout');
  const number = (b: Buffer) => { if (b.length > 1 || (b[0] ?? 0) > 127) throw Error('Invalid action/slot'); return b[0] ?? 0; };
  return { state: pushes[4]!, action: number(pushes[3]!), slot: number(pushes[2]!), record: pushes[1]! };
}
export function termsFor(config: VaultConfig, category: string, state: Buffer, slot: number) {
  const p = state.readUInt32LE(0), r = state.subarray(SNAPSHOT + slot * RECORD_SIZE, SNAPSHOT + (slot + 1) * RECORD_SIZE);
  return allocationTerms(r.subarray(0,33), category, config.stakingCategory, slot, p, r.readUInt32LE(33), periodBoundary(config, p + r.readUInt32LE(37)));
}
export const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n';
