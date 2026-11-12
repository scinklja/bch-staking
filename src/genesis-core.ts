import { Buffer } from './bytes.js';
import { satoshis } from './amount.js';
export { satoshis } from './amount.js';
import { contract } from './arena-core.js';
import { type NetworkProvider } from 'cashscript';
import { hashState, periodBoundary, STATE_SIZE } from './registry.js';

export interface GenesisParameters {
  stakingCategory: string; epoch: number; periodSeconds: number; periods: number; cap: number;
}
/** Verify a covenant-created instance. Confirmation is required by default; only the display replay opts out after mempool VM validation. */
export async function verifyRegistryGenesis(txid: string, parameters: GenesisParameters, read: (txid: string) => Promise<any>, networkProvider: NetworkProvider, allowUnconfirmed = false) {
  const transaction = read;
  const { stakingCategory, epoch, periodSeconds, periods, cap } = parameters;
  if (!/^[0-9a-f]{64}$/i.test(txid) || !/^[0-9a-f]{64}$/i.test(stakingCategory)
      || !Number.isInteger(periods) || periods < 1 || periods > 16
      || !Number.isInteger(cap) || cap < 1000 || cap > 1000000) throw Error('Invalid genesis parameters');
  periodBoundary(parameters, 2 * periods - 1);
  const tx = await transaction(txid);
  if ((!allowUnconfirmed && !(tx.confirmations > 0)) || tx.vin.length !== 1 || tx.vin[0].vout !== 0 || tx.vout.length !== 2) throw Error('Unconfirmed or malformed genesis');
  const category: string = tx.vin[0].txid;
  if (category === stakingCategory) throw Error('State and staking categories must differ');
  const previous = await transaction(category);
  const asset = Buffer.from(stakingCategory, 'hex').reverse();
  const vault = Buffer.from(category, 'hex').reverse();
  const args = [asset, BigInt(epoch), BigInt(periodSeconds), BigInt(periods), BigInt(cap)];
  const factory = await contract('RegistryGenesis', args, networkProvider);
  const registry = await contract('Registry', [vault, ...args], networkProvider);
  const pool = await contract('StakePool', [Buffer.concat([vault, asset])], networkProvider);
  if (previous.vout[0].scriptPubKey.hex !== factory.lockingBytecode || previous.vout[0].tokenData) throw Error('Genesis lacks pinned factory authorization');
  const [state, escrow] = tx.vout;
  if (state.scriptPubKey.hex !== registry.lockingBytecode || escrow.scriptPubKey.hex !== pool.lockingBytecode
      || satoshis(state) !== satoshis(previous.vout[0]) - 11000n
      || satoshis(state) < BigInt(periods) * BigInt(cap) + 1000n || satoshis(escrow) !== 1000n
      || escrow.tokenData || state.tokenData?.category !== category || BigInt(state.tokenData.amount ?? 0) !== 0n
      || state.tokenData.nft?.capability !== 'mutable' || state.tokenData.nft.commitment !== hashState(Buffer.alloc(STATE_SIZE))) throw Error('Invalid genesis outputs');
  return { category, state: `${txid}:0`, pool: `${txid}:1`, parameters, factory: factory.address, confirmationBlock: tx.blockhash };
}

