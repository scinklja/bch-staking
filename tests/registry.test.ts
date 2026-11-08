import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cashAddressToLockingBytecode, binToHex, encodeCashAddress, hash160 } from '@bitauth/libauth';
import { Contract, SignatureTemplate, TransactionBuilder, type SpendableUtxo, type TokenDetails } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { TokenRegtestProvider } from '../src/token-provider.js';
import { hashState, nextState, offer, STATE_SIZE, LIVE, SNAPSHOT, RECORD_SIZE, periodBoundary } from '../src/legacy-registry.js';

test('legacy 16-offer authenticated registry: registration, immutable activation, cancellation and settlement', { timeout: 240000 }, async () => {
  await assertRegtest();
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  const provider = new TokenRegtestProvider();
  const artifact = JSON.parse(await readFile('artifacts/LegacyRegistry.json', 'utf8'));
  const depositArtifact = JSON.parse(await readFile('artifacts/RegistryDeposit.json', 'utf8'));
  const opts = { provider, contractType: 'p2sh32' as const };
  const signers = Array.from({ length: 16 }, (_, i) => new SignatureTemplate(new Uint8Array(32).fill(i + 20)));
  const depositor = signers[0]!;
  const deposit = new Contract(depositArtifact, [depositor.publicKey], opts);
  const mining = await rpc<string>('getnewaddress');
  const evidence: unknown[] = [];
  async function mine(n = 1) { await rpc('generatetoaddress', [n, mining]); }
  function script(address: string) {
    const d = cashAddressToLockingBytecode(address); if (typeof d === 'string') throw Error(d); return binToHex(d.bytecode);
  }
  async function output(txid: string, address: string): Promise<SpendableUtxo> {
    const tx = await rpc('getrawtransaction', [txid, true]);
    const out = tx.vout.find((v: any) => v.scriptPubKey.hex === script(address));
    assert.ok(out);
    return { txid, vout: out.n, satoshis: BigInt(Math.round(out.value * 1e8)), lockingBytecode: out.scriptPubKey.hex,
      ...(out.tokenData ? { token: { category: out.tokenData.category, amount: BigInt(out.tokenData.amount ?? 0), nft: out.tokenData.nft } } : {}) };
  }
  async function fund(amount: bigint) {
    return output(await rpc<string>('sendtoaddress', [deposit.address, Number(amount) / 1e8]), deposit.address);
  }
  const funding = await fund(1020000n);
  const pregen = await new TransactionBuilder({ provider }).addInput(funding, deposit.unlock.spend(depositor))
    .addOutput({ to: deposit.address, amount: 1010000n }).send();
  const genesisInput = await output(pregen.txid, deposit.address);
  assert.equal(genesisInput.vout, 0);
  const category = pregen.txid;
  const info = await rpc('getblockchaininfo');
  const schedule = { epoch: Math.ceil((Math.max(Date.now() / 1000, info.mediantime) + 40) / 10) * 10, periodSeconds: 10 };
  const boundary = (p: number) => periodBoundary(schedule, p);
  async function crossBoundary(p: number) {
    while (Date.now() / 1000 <= boundary(p) + 2) await new Promise(resolve => setTimeout(resolve, 250));
    await mine(12);
    assert.ok((await rpc('getblockchaininfo')).mediantime > boundary(p));
  }
  const registry = new Contract(artifact, [Buffer.from(category, 'hex').reverse(), BigInt(schedule.epoch), BigInt(schedule.periodSeconds), 4n, 2000n], opts);
  let state: Buffer = Buffer.alloc(STATE_SIZE);
  const token = (s: Uint8Array): TokenDetails => ({ category, amount: 0n, nft: { capability: 'mutable', commitment: hashState(s) } });
  const genesis = await new TransactionBuilder({ provider }).addInput(genesisInput, deposit.unlock.spend(depositor))
    .addOutput({ to: registry.tokenAddress, amount: 1000000n, token: token(state) }).send();
  const genesisTx = await rpc('getrawtransaction', [genesis.txid, true]);
  // Protocol genesis admission checks: consensus does not force a creator to choose these.
  assert.equal(genesisTx.vout.length, 1);
  assert.equal(genesisTx.vout[0].tokenData.nft.capability, 'mutable');
  assert.equal(genesisTx.vout[0].tokenData.nft.commitment, hashState(state));
  assert.equal(genesisTx.vout[0].tokenData.category, category);
  assert.equal(genesisTx.vout[0].tokenData.amount, '0');
  assert.equal(Math.round(genesisTx.vout[0].value * 1e8), 1000000);
  let current = await output(genesis.txid, registry.address);
  await mine();
  // Verify the opt-in provider also returns the NFT faithfully.
  assert.equal((await provider.getUtxos(registry.address)).find(u => u.txid === genesis.txid)!.token!.nft!.commitment, hashState(state));
  const records = signers.map((s, i) => offer(s.publicKey, i === 0 || i === 15 ? 6000 : i === 1 ? 5000 : 1000,
    2, 1000, i === 0 ? 1 : 2));
  async function build(action: number, slot = 0, record = Buffer.alloc(0), signer = depositor,
    changes: { next?: Buffer; witness?: Buffer; locktime?: number; deposit?: SpendableUtxo; payout?: number; sequence?: number } = {}) {
    const next = changes.next ?? nextState(state, action, slot, record, schedule);
    const b = new TransactionBuilder({ provider }).setLocktime(changes.locktime ?? Math.max(action === 2 ? boundary(state.readUInt32LE(0)) : 0, (await rpc('getblockchaininfo')).mediantime - 1))
      .addInput(current, registry.unlock.transition(changes.witness ?? state, BigInt(action), BigInt(slot), record, signer),
        changes.sequence === undefined ? {} : { sequence: changes.sequence });
    let amount = current.satoshis - 10000n;
    if (action === 0) {
      assert.ok(changes.deposit);
      b.addInput(changes.deposit, deposit.unlock.spend(depositor));
      amount = current.satoshis + BigInt(record.readUInt32LE(33));
    }
    const payout = changes.payout ?? (action === 3 ? state.readUInt32LE(SNAPSHOT + slot * RECORD_SIZE + 41)
      : action === 4 ? state.readUInt32LE(LIVE + slot * RECORD_SIZE + 33) : 0);
    if (action === 3 || action === 4) amount -= BigInt(payout);
    b.addOutput({ to: registry.tokenAddress, amount, token: token(next) });
    if (action === 3 || action === 4) {
      const key = state.subarray((action === 3 ? SNAPSHOT : LIVE) + slot * RECORD_SIZE, (action === 3 ? SNAPSHOT : LIVE) + slot * RECORD_SIZE + 33);
      const address = encodeCashAddress({ prefix: 'bchreg', type: 'p2pkh', payload: hash160(key) });
      if (typeof address === 'string') throw Error(address);
      b.addOutput({ to: address.address, amount: BigInt(payout) });
    }
    return { raw: b.build(), next };
  }
  async function check(raw: string, name: string, reason?: RegExp) {
    const [result] = await rpc('testmempoolaccept', [[raw]]);
    evidence.push({ name, result });
    assert.equal(result.allowed, !reason, `${name}: ${JSON.stringify(result)}`);
    if (reason) assert.match(result['reject-reason'], reason, name);
  }
  const scriptFailure = /mandatory-script-verify-flag-failed.*OP_/;
  async function apply(b: { raw: string; next: Buffer }, name: string) {
    await check(b.raw, name);
    const txid = await provider.sendRawTransaction(b.raw);
    state = b.next; current = await output(txid, registry.address);
    return txid;
  }
  // UTC guards apply only to activation and winning collateral withdrawal.
  const oldHeight = await provider.getBlockHeight();
  const d0 = await fund(16000n);
  await check((await build(0, 1, records[0]!, depositor, { deposit: d0, locktime: oldHeight })).raw,
    'forged sequence: first registration claims slot 1', scriptFailure);
  const forgedWins = Buffer.from(records[0]!); forgedWins[46] = 1;
  await check((await build(0, 0, forgedWins, depositor, { deposit: d0, locktime: oldHeight })).raw,
    'forged initial win counter', scriptFailure);
  for (let i = 0; i < 15; i++) {
    const d = i === 0 ? d0 : await fund(BigInt(records[i]!.readUInt32LE(33) + 10000));
    await apply(await build(0, i, records[i]!, signers[i]!, { deposit: d, locktime: await provider.getBlockHeight() }), `register canonical slot ${i}`);
    await mine();
  }
  assert.equal(state[5], 15);
  await check((await build(1, 14, Buffer.alloc(0), depositor, { locktime: await provider.getBlockHeight() })).raw,
    'unauthorized cancellation', /mandatory-script-verify-flag-failed.*Signature must be zero/);
  const early = await build(2, 0, Buffer.alloc(0), depositor, { locktime: boundary(0) });
  await check(early.raw, 'premature activation with threshold locktime', /nonfinal/);
  await check((await build(2, 0, Buffer.alloc(0), depositor, { locktime: await provider.getBlockHeight() })).raw,
    'premature activation with backdated locktime', /Locktime requirement not satisfied/);
  // Delay activation beyond the next nominal boundary. Eligibility still follows the baton.
  await crossBoundary(1);
  await apply(await build(1, 14, Buffer.alloc(0), signers[14]!), 'post-UTC pre-activation cancellation included in snapshot');
  const lastDeposit = await fund(16000n);
  await apply(await build(0, 15, records[15]!, signers[15]!, { deposit: lastDeposit }),
    'post-UTC pre-activation registration included in snapshot');
  assert.equal(state[5], 16);
  const overflowDeposit = await fund(16000n);
  await check((await build(0, 16, records[0]!, depositor, { deposit: overflowDeposit, locktime: await provider.getBlockHeight() })).raw,
    '17th registration rejected', scriptFailure);

  const activation = await build(2);
  const omit = Buffer.from(activation.next); omit.fill(0, SNAPSHOT + 15 * RECORD_SIZE, SNAPSHOT + 16 * RECORD_SIZE);
  await check((await build(2, 0, Buffer.alloc(0), depositor, { next: omit })).raw, 'snapshot omission of last offer', scriptFailure);
  const reseq = Buffer.from(state); reseq.set(records[15]!, LIVE); reseq.set(records[0]!, LIVE + 15 * RECORD_SIZE);
  await check((await build(2, 0, Buffer.alloc(0), depositor, { witness: reseq })).raw, 'forged authenticated registration order', scriptFailure);
  await apply(activation, 'delayed UTC activation of complete roster');
  await mine();
  const frozen = Buffer.from(state.subarray(SNAPSHOT));
  const cancel = await build(1, 15, Buffer.alloc(0), signers[15]!);
  const tamper = Buffer.from(cancel.next); tamper[SNAPSHOT + 15 * RECORD_SIZE + 47] = 1;
  await check((await build(1, 15, Buffer.alloc(0), signers[15]!, { next: tamper })).raw,
    'cancellation cannot modify activated snapshot', scriptFailure);
  await apply(cancel, 'late cancellation affects future eligibility only');
  assert.deepEqual(state.subarray(SNAPSHOT), frozen);
  await check((await build(4, 15, Buffer.alloc(0), signers[15]!)).raw, 'activated collateral cannot be withdrawn', scriptFailure);
  await check((await build(2)).raw, 'activated period cannot be reactivated', scriptFailure);
  await check((await build(5)).raw, 'cannot skip nonempty activated roster', scriptFailure);
  await check((await build(3, 1)).raw, 'lower-ranked winner rejected across full roster', scriptFailure);
  await check((await build(3, 15)).raw, 'equal score loses to sequence zero despite late cancellation', scriptFailure);
  const winning = await build(3, 0);
  const shortened = Buffer.from(winning.next); shortened.writeUInt32LE(boundary(1), LIVE + 49);
  await check((await build(3, 0, Buffer.alloc(0), depositor, { next: shortened })).raw,
    'settlement cannot shorten fixed UTC maturity', scriptFailure);
  const shifted = Buffer.from(winning.next); shifted.writeUInt32LE(boundary(2) + 10, LIVE + 49);
  await check((await build(3, 0, Buffer.alloc(0), depositor, { next: shifted })).raw,
    'late settlement cannot shift fixed UTC maturity', scriptFailure);
  const competing = await build(3, 0, Buffer.alloc(0), depositor, { locktime: boundary(0) });
  await check(competing.raw, 'independently valid duplicate settlement candidate');
  const settled = await apply(winning, 'earliest registered equal-score offer wins');
  await check(competing.raw, 'duplicate settlement conflicts', /txn-mempool-conflict/);
  await mine();
  await assert.rejects(() => provider.sendRawTransaction(winning.raw), /already|spent|missing|chain/i);
  assert.equal(state.readUInt32LE(0), 1);
  assert.equal(state[LIVE + 46], 1);
  assert.equal(state.readUInt32LE(LIVE + 49), boundary(2));
  assert.equal(state[SNAPSHOT + 14 * RECORD_SIZE + 47], 1);
  assert.equal(state[SNAPSHOT + 15 * RECORD_SIZE + 47], 0);
  // UTC maturity stays unchanged through unrelated state transitions.
  // Activate next period after threshold; cancelled slot 15 and maxed slot 0 cannot win.
  await apply(await build(2), 'second period authenticated snapshot');
  await check((await build(3, 0)).raw, 'maximum wins alone prevents winning again', scriptFailure);
  await check((await build(3, 15)).raw, 'late cancellation excluded from next snapshot', scriptFailure);
  await apply(await build(1, 0, Buffer.alloc(0), signers[0]!), 'cancel exhausted winner future eligibility');
  const second = await apply(await build(3, 1), 'next complete roster selects next eligible rank');
  await mine();
  assert.equal(state.readUInt32LE(LIVE + RECORD_SIZE + 49), boundary(3));
  assert.equal(state.readUInt32LE(LIVE + 49), boundary(2));
  await check((await build(4, 0, Buffer.alloc(0), signers[0]!, { locktime: boundary(2) })).raw,
    'future UTC maturity locktime is nonfinal', /nonfinal/);
  await check((await build(4, 0, Buffer.alloc(0), signers[0]!, { locktime: boundary(0) })).raw,
    'backdated withdrawal cannot bypass UTC maturity', /Locktime requirement not satisfied/);
  await crossBoundary(2);
  await apply(await build(4, 0, Buffer.alloc(0), signers[0]!, { locktime: boundary(2) }),
    'mature UTC collateral withdrawal despite intervening state updates');
  await mine();
  await check((await build(4, 0, Buffer.alloc(0), signers[0]!)).raw, 'duplicate collateral withdrawal', scriptFailure);
  await apply(await build(2), 'third UTC period activation');
  await apply(await build(3, 1), 'repeat winner extends maturity to its latest fixed period end');
  assert.equal(state.readUInt32LE(LIVE + RECORD_SIZE + 49), boundary(4));
  for (let i = 1; i < 14; i++) {
    await apply(await build(1, i, Buffer.alloc(0), signers[i]!), `cancel future eligibility slot ${i}`);
    if (i % 4 === 0) await mine();
  }
  await crossBoundary(3);
  await apply(await build(2), 'empty eligible snapshot still authenticates all 16 records');

  await apply(await build(5), 'final empty-period advancement');
  await check((await build(2, 0, Buffer.alloc(0), depositor, { locktime: boundary(0) })).raw, 'finite vault cannot activate extra periods', scriptFailure);
  await check((await build(4, 1, Buffer.alloc(0), signers[1]!, { locktime: boundary(3) })).raw,
    'repeat winner cannot use its earlier maturity', /Locktime requirement not satisfied/);
  await crossBoundary(4);
  await apply(await build(4, 1, Buffer.alloc(0), signers[1]!, { locktime: boundary(4) }),
    'repeat winner withdraws at fixed maturity after final reward period');
  await apply(await build(4, 15, Buffer.alloc(0), signers[15]!), 'never-winning cancelled offer withdraws without maturity lock');
  await mine();
  const payout = await rpc('getrawtransaction', [settled, true]);
  assert.ok(payout.confirmations >= 1);
  assert.equal(Math.round(payout.vout[1].value * 1e8), 1000);
  evidence.push({ genesis: genesis.txid, category, settled, second, schedule, registryBytes: registry.bytesize,
    activationBytes: activation.raw.length / 2, settlementBytes: winning.raw.length / 2, stateBytes: state.length });
  await writeFile('docs/registry-test-result.json', JSON.stringify(evidence, null, 2) + '\n');
});
