import { contracts as coreContracts } from './arena-core.js';
import { readFile } from 'node:fs/promises';
import { Contract, type NetworkProvider } from 'cashscript';
import { TokenBchnProvider } from './token-provider.js';

export const provider = new TokenBchnProvider();
export async function contract(name: string, args: (bigint | Uint8Array)[], networkProvider: NetworkProvider = provider) {
  return new Contract(JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8')), args,
    { provider: networkProvider, contractType: 'p2sh32' });
}
export async function contracts(config: VaultConfig, category: string, networkProvider: NetworkProvider = provider) {
  return coreContracts(config, category, networkProvider);
}
export type { VaultConfig } from './arena-core.js';
import type { VaultConfig } from './arena-core.js';
export { utxo, records, rankings, transitionWitness, termsFor, json } from './arena-core.js';
