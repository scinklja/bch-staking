import { readFile } from 'node:fs/promises';
import { Contract } from 'cashscript';
import { TokenRegtestProvider } from './token-provider.js';
import { assertRegtest, rpc } from './rpc.js';
import { hashState, periodBoundary, STATE_SIZE } from './registry.js';

export interface GenesisParameters {
  stakingCategory: string; epoch: number; periodSeconds: number; periods: number; cap: number;
}
/** Admit only an active-chain, covenant-created instance. Callers must pin the returned genesis outpoints. */
export async function verifyRegistryGenesis(txid: string, parameters: GenesisParameters) {
  await assertRegtest();
  const { stakingCategory, epoch, periodSeconds, periods, cap } = parameters;
  if (!/^[0-9a-f]{64}$/i.test(txid) || !/^[0-9a-f]{64}$/i.test(stakingCategory)
      || !Number.isInteger(periods) || periods < 1 || periods > 16
      || !Number.isInteger(cap) || cap < 1000 || cap > 1000000) throw Error('Invalid genesis parameters');
  periodBoundary(parameters, 2 * periods - 1);
  const tx = await rpc('getrawtransaction', [txid, true]);
  if (!(tx.confirmations > 0) || tx.vin.length !== 1 || tx.vin[0].vout !== 0 || tx.vout.length !== 2) throw Error('Unconfirmed or malformed genesis');
  const category: string = tx.vin[0].txid;
  if (category === stakingCategory) throw Error('State and staking categories must differ');
  const previous = await rpc('getrawtransaction', [category, true]);
  const provider = new TokenRegtestProvider();
  const options = { provider, contractType: 'p2sh32' as const };
  const artifact = async (name: string) => JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8'));
  const asset = Buffer.from(stakingCategory, 'hex').reverse();
  const vault = Buffer.from(category, 'hex').reverse();
  const args = [asset, BigInt(epoch), BigInt(periodSeconds), BigInt(periods), BigInt(cap)];
  const factory = new Contract(await artifact('RegistryGenesis'), args, options);
  const registry = new Contract(await artifact('Registry'), [vault, ...args], options);
  const pool = new Contract(await artifact('StakePool'), [Buffer.concat([vault, asset])], options);
  if (previous.vout[0].scriptPubKey.hex !== factory.lockingBytecode || previous.vout[0].tokenData) throw Error('Genesis lacks pinned factory authorization');
  const [state, escrow] = tx.vout;
  if (state.scriptPubKey.hex !== registry.lockingBytecode || escrow.scriptPubKey.hex !== pool.lockingBytecode
      || Math.round(state.value * 1e8) !== Math.round(previous.vout[0].value * 1e8) - 11000
      || Math.round(state.value * 1e8) < periods * cap + 1000 || Math.round(escrow.value * 1e8) !== 1000
      || escrow.tokenData || state.tokenData?.category !== category || BigInt(state.tokenData.amount ?? 0) !== 0n
      || state.tokenData.nft?.capability !== 'mutable' || state.tokenData.nft.commitment !== hashState(Buffer.alloc(STATE_SIZE))) throw Error('Invalid genesis outputs');
  return { category, state: `${txid}:0`, pool: `${txid}:1`, parameters, factory: factory.address, confirmationBlock: tx.blockhash };
}
