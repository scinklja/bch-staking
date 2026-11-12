import {buildCreatePlan,buildGenesis,buildPreparation,buildRegistration} from './transactions-core.js';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, encodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import { TransactionBuilder, placeholderSignature, type SpendableUtxo } from 'cashscript';
import { contract, provider, utxo } from './arena.js';
import { assertNetwork, networkConfig, rpc } from './rpc.js';
import { verifyRegistryGenesis, type GenesisParameters } from './genesis.js';
import type { VaultState, Allocation } from './indexer.js';

export function walletAddress(publicKey: Uint8Array) {
  if (publicKey.length !== 33 || ![2,3].includes(publicKey[0]!)) throw Error('Expected compressed wallet public key');
  const result = encodeCashAddress({ prefix: networkConfig().prefix, type: 'p2pkhWithTokens', payload: hash160(publicKey) });
  if (typeof result === 'string') throw Error(result);
  return result.address;
}
/** Never trust browser-supplied values, tokens or scripts for a funding outpoint. */
export async function walletInput(txid: string, vout: number, publicKey: Uint8Array) {
  await assertNetwork(true);
  if (!/^[a-f0-9]{64}$/i.test(txid) || !Number.isInteger(vout) || vout < 0) throw Error('Invalid outpoint');
  const live = await rpc('gettxout', [txid, vout, true]);
  const decoded = cashAddressToLockingBytecode(walletAddress(publicKey));
  if (typeof decoded === 'string' || !live || live.scriptPubKey.hex !== binToHex(decoded.bytecode)) throw Error('Funding is spent or does not belong to connected wallet');
  const tx = await rpc('getrawtransaction', [txid, true]);
  return utxo(tx, vout);
}
export interface WalletPlan {
  label: string;
  request: ReturnType<TransactionBuilder['generateWcTransactionObject']>;
  inputPaths: [number, 'receive' | 'change' | 'defi', number][];
}
function plan(label: string, builder: TransactionBuilder, inputPaths: WalletPlan['inputPaths']): WalletPlan {
  return { label, request: builder.generateWcTransactionObject({ broadcast: false, userPrompt: `CHIPNET TEST FUNDS ONLY: ${label}` }), inputPaths };
}
function requireChipnet() { if (networkConfig().network !== 'chipnet') throw Error('Wallet transaction flows are chipnet-only'); }
/** First wallet-authorized step commits reward budget and immutable terms to factory vout 0. */
export async function createVaultPlan(parameters: GenesisParameters, funding: SpendableUtxo, publicKey: Uint8Array, reserve: bigint, path: WalletPlan['inputPaths'][number] = [0,'receive',0]) {
  requireChipnet(); await assertNetwork(true);
  const key={publicKey:binToHex(publicKey),path:path[1],index:path[2]};
  return buildCreatePlan(parameters,[{...key,utxo:funding}],key,provider,reserve);
}
/** Factory spend needs no signature; its funded parent is wallet-authorized. */
export async function createVaultGenesis(parameters: GenesisParameters, pregenesis: string) {
  requireChipnet(); const info=await assertNetwork(true);
  const tx=await rpc('getrawtransaction',[pregenesis,true]);
  const raw=await buildGenesis(parameters,tx,provider,{height:info.blocks,mtp:info.mediantime});
  const [accept]=await rpc('testmempoolaccept',[[raw]]);
  if(!accept.allowed)throw Error(`Genesis rejected: ${accept['reject-reason']}`);
  return {raw,parameters,pregenesis};
}
/** Split S*W token units into a dedicated wallet output before canonical registration. */
export async function prepareOfferFunding(input: SpendableUtxo, publicKey: Uint8Array, amount: bigint, path: WalletPlan['inputPaths'][number] = [0,'receive',0]) {
  requireChipnet(); await assertNetwork(true);
  if(!input.token || input.satoshis<15000n)throw Error('Insufficient fungible token funding');
  const key={publicKey:binToHex(publicKey),path:path[1],index:path[2]};
  return buildPreparation([{...key,utxo:input}],key,key,input.token.category,amount,provider);
}
export async function makeOfferPlan(vault: VaultState, funding: SpendableUtxo, publicKey: Uint8Array, terms: { stake: number; duration: number; reward: number; maxWins: number }, path: 'receive' | 'change' | 'defi' = 'receive', index = 0) {
  requireChipnet(); const info=await assertNetwork(true);await verifyRegistryGenesis(vault.config.genesis,vault.config);
  const key={publicKey:binToHex(publicKey),path,index};
  return buildRegistration(vault,{...key,utxo:funding},key,terms,provider,{height:info.blocks,mtp:info.mediantime});
}
export async function withdrawAllocationPlan(allocation: Allocation, publicKey: Uint8Array, path: WalletPlan['inputPaths'][number] = [0,'receive',0]) {
  requireChipnet(); const info = await assertNetwork(true);
  const terms = Buffer.from(allocation.terms,'hex');
  if (allocation.withdrawal || !terms.subarray(0,33).equals(Buffer.from(publicKey)) || info.mediantime <= terms.readUInt32LE(74)) throw Error('Allocation is spent, immature or owned by another wallet');
  const [txid,vout] = allocation.id.split(':');
  const input = utxo(await rpc('getrawtransaction',[txid,true]),Number(vout));
  const lock = await contract('StakeAllocation',[terms]);
  const builder = new TransactionBuilder({ provider }).setLocktime(terms.readUInt32LE(74))
    .addInput(input,lock.unlock.withdraw(placeholderSignature()))
    .addOutput({ to: walletAddress(publicKey), amount: 1000n, token: input.token });
  return plan('Withdraw independent mature stake allocation',builder,[path]);
}
/** Wallet may replace signatures only. A changed destination, fee, input or token is rejected. */
export async function submitWalletPlan(pending: WalletPlan, signedHex: string) {
  requireChipnet(); await assertNetwork(true);
  const signed = decodeTransaction(hexToBin(signedHex));
  if (typeof signed === 'string') throw Error('Malformed signed transaction');
  const shape = (tx: typeof signed) => JSON.stringify({ ...tx, inputs: tx.inputs.map(i => ({ ...i, unlockingBytecode: [] })) }, (_,v) => typeof v === 'bigint' ? v.toString() : v);
  if (shape(signed) !== shape(pending.request.transaction)) throw Error('Wallet altered the authorized transaction');
  const [accept] = await rpc('testmempoolaccept', [[signedHex]]);
  if (!accept.allowed) throw Error(`Transaction rejected: ${accept['reject-reason']}`);
  await assertNetwork(true);
  return { status: 'broadcast', txid: await rpc<string>('sendrawtransaction',[signedHex]) };
}
