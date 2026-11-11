import { binToHex, cashAddressToLockingBytecode, decodeTransaction, encodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import { TransactionBuilder, placeholderP2PKHUnlocker, placeholderSignature, type SpendableUtxo } from 'cashscript';
import { contract, contracts, provider, utxo, type VaultConfig } from './arena.js';
import { assertNetwork, networkConfig, rpc } from './rpc.js';
import { hashState, nextState, offer, remainingCommitment, STATE_SIZE } from './registry.js';
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
  if (funding.token || reserve < BigInt(parameters.periods * parameters.cap + 1000) + BigInt(parameters.periods) * 22000n + 20000n) throw Error('Insufficient lifecycle reserve or token-bearing funding');
  const args = [Buffer.from(parameters.stakingCategory, 'hex').reverse(), BigInt(parameters.epoch), BigInt(parameters.periodSeconds), BigInt(parameters.periods), BigInt(parameters.cap)];
  // Validate schedule/category bounds through the same canonical genesis verifier before funds are committed.
  const { periodBoundary } = await import('./registry.js');
  periodBoundary(parameters, 2 * parameters.periods - 1);
  if (!/^[a-f0-9]{64}$/i.test(parameters.stakingCategory) || parameters.periods < 1 || parameters.periods > 16 || parameters.cap < 1000 || parameters.cap > 1000000) throw Error('Invalid genesis parameters');
  const factory = await contract('RegistryGenesis', args);
  const change = funding.satoshis - reserve - 11000n - 2000n;
  if (change < 1000n) throw Error('Funding must cover reserve, genesis fee, creation fee and change dust');
  return plan('Create Vault: fund canonical factory', new TransactionBuilder({ provider })
    .addInput(funding, placeholderP2PKHUnlocker(walletAddress(publicKey)))
    .addOutput({ to: factory.address, amount: reserve + 11000n })
    .addOutput({ to: walletAddress(publicKey), amount: change }), [path]);
}
/** Factory spend needs no signature; its funded parent is wallet-authorized. */
export async function createVaultGenesis(parameters: GenesisParameters, pregenesis: string) {
  requireChipnet(); await assertNetwork(true);
  const tx = await rpc('getrawtransaction', [pregenesis, true]);
  const input = utxo(tx, 0), cs = await contracts({ ...parameters, genesis: '' }, pregenesis);
  const factory = await contract('RegistryGenesis', [Buffer.from(parameters.stakingCategory, 'hex').reverse(), BigInt(parameters.epoch), BigInt(parameters.periodSeconds), BigInt(parameters.periods), BigInt(parameters.cap)]);
  if (input.lockingBytecode !== factory.lockingBytecode || input.token) throw Error('Incorrect factory funding');
  const raw = new TransactionBuilder({ provider }).addInput(input, factory.unlock.create())
    .addOutput({ to: cs.registry.tokenAddress, amount: input.satoshis - 11000n, token: { category: pregenesis, amount: 0n, nft: { capability: 'mutable', commitment: hashState(Buffer.alloc(STATE_SIZE)) } } })
    .addOutput({ to: cs.pool.address, amount: 1000n }).build();
  const [accept] = await rpc('testmempoolaccept', [[raw]]);
  if (!accept.allowed) throw Error(`Genesis rejected: ${accept['reject-reason']}`);
  return { raw, parameters, pregenesis };
}
/** Split S*W token units into a dedicated wallet output before canonical registration. */
export async function prepareOfferFunding(input: SpendableUtxo, publicKey: Uint8Array, amount: bigint, path: WalletPlan['inputPaths'][number] = [0,'receive',0]) {
  requireChipnet(); await assertNetwork(true);
  if (!input.token || input.token.nft || input.token.amount < amount || amount <= 0n || input.satoshis < 15000n) throw Error('Insufficient fungible token funding');
  const builder = new TransactionBuilder({ provider }).addInput(input, placeholderP2PKHUnlocker(walletAddress(publicKey)))
    .addOutput({ to: walletAddress(publicKey), amount: 10000n, token: { category: input.token.category, amount } });
  const remainder = input.token.amount - amount;
  builder.addOutput({ to: walletAddress(publicKey), amount: input.satoshis - 12000n, ...(remainder ? { token: { category: input.token.category, amount: remainder } } : {}) });
  return plan('Prepare exact offer escrow', builder, [path]);
}
export async function makeOfferPlan(vault: VaultState, funding: SpendableUtxo, publicKey: Uint8Array, terms: { stake: number; duration: number; reward: number; maxWins: number }, path: 'receive' | 'change' | 'defi' = 'receive', index = 0) {
  requireChipnet(); await assertNetwork(true);
  await verifyRegistryGenesis(vault.config.genesis, vault.config);
  const state = Buffer.from(vault.witness, 'hex'), slot = state[5]!;
  if (state[4] || slot >= 16 || state.readUInt32LE(0) >= vault.config.periods) throw Error('Registration is closed');
  if (!funding.token || funding.token.nft || funding.token.category !== vault.config.stakingCategory || funding.token.amount !== BigInt(terms.stake) * BigInt(terms.maxWins) || funding.satoshis < 5000n || funding.satoshis > 20000n) throw Error('Use exact S*W escrow with bounded BCH fee carrier');
  if (!Object.values(terms).every(Number.isInteger) || terms.stake < 1000 || terms.stake > 1000000 || terms.duration < 1 || terms.duration > vault.config.periods || terms.maxWins < 1 || terms.maxWins > vault.config.periods || terms.reward < 1000 || terms.reward > vault.config.cap) throw Error('Offer terms violate covenant bounds');
  const record = offer(publicKey, terms.stake, terms.duration, terms.reward, terms.maxWins);
  const next = nextState(state, 0, slot, record), cs = await contracts(vault.config, vault.category);
  const builder = new TransactionBuilder({ provider }).setLocktime((await rpc('getblockchaininfo')).mediantime - 1)
    .addInput(utxo(vault.transaction,0), cs.registry.unlock.transition(state, 0n, BigInt(slot), record, placeholderSignature()))
    .addInput(utxo(vault.transaction,1), cs.pool.unlock.spend())
    .addInput(funding, placeholderP2PKHUnlocker(walletAddress(publicKey)))
    .addOutput({ to: cs.registry.tokenAddress, amount: utxo(vault.transaction,0).satoshis, token: { category: vault.category, amount: 0n, nft: { capability: 'mutable', commitment: hashState(next) } } })
    .addOutput({ to: cs.pool.tokenAddress, amount: 1000n, token: { category: vault.config.stakingCategory, amount: remainingCommitment(next) } });
  return plan('Make an Offer: authorize registration and S×W escrow', builder, [[0,path,index],[2,path,index]]);
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
