import type { NetworkProvider } from 'cashscript';
import { TokenBchnProvider } from './token-provider.js';
import { assertNetwork, rpc } from './rpc.js';
import { verifyRegistryGenesis as verify, type GenesisParameters } from './genesis-core.js';
export type { GenesisParameters } from './genesis-core.js';
export { satoshis } from './amount.js';
export async function verifyRegistryGenesis(txid: string, parameters: GenesisParameters, read?: (id: string) => Promise<any>, provider?: NetworkProvider) {
  if (!read) await assertNetwork();
  return verify(txid, parameters, read ?? (id => rpc('getrawtransaction', [id, true])), provider ?? new TokenBchnProvider());
}
