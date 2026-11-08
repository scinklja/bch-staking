import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { binToHex, cashAddressToLockingBytecode, encodeCashAddress, hash160 } from '@bitauth/libauth';
import { Contract, SignatureTemplate, TransactionBuilder, type SpendableUtxo, type TokenDetails } from 'cashscript';
import { assertRegtest, rpc } from '../src/rpc.js';
import { TokenRegtestProvider } from '../src/token-provider.js';
import { hashState, LIVE, nextState, offer, periodBoundary, RECORD_SIZE, SNAPSHOT, STATE_SIZE } from '../src/legacy-registry.js';

// Verification of the existing covenant, including counterexamples to unmet requirements.
// Historical UTC boundaries make late settlement deterministic without changing node time.
test('legacy registry verification: late maturity, frozen snapshots, serial reserves and allocation limitation', { timeout: 120000 }, async () => {
  await assertRegtest();
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  const before = await rpc('getblockchaininfo');
  const provider = new TokenRegtestProvider();
  const artifact = JSON.parse(await readFile('artifacts/LegacyRegistry.json', 'utf8'));
  const depositArtifact = JSON.parse(await readFile('artifacts/RegistryDeposit.json', 'utf8'));
  const options = { provider, contractType: 'p2sh32' as const };
  const signer = new SignatureTemplate(new Uint8Array(32).fill(80)); // Public regtest key only.
  const deposit = new Contract(depositArtifact, [signer.publicKey], options);
  const mining = await rpc<string>('getnewaddress');
  const schedule = { epoch: Math.floor((Math.min(before.mediantime, Date.now() / 1000) - 10000) / 10) * 10, periodSeconds: 10 };
  const boundary = (p: number) => periodBoundary(schedule, p);
  const evidence: any[] = [];
  const scriptFailure = /mandatory-script-verify-flag-failed/;
  const mine = () => rpc('generatetoaddress', [1, mining]);
  function script(address: string) {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw Error(decoded);
    return binToHex(decoded.bytecode);
  }
  async function output(txid: string, address: string): Promise<SpendableUtxo> {
    const tx = await rpc('getrawtransaction', [txid, true]);
    const v = tx.vout.find((v: any) => v.scriptPubKey.hex === script(address));
    assert.ok(v);
    return { txid, vout: v.n, satoshis: BigInt(Math.round(v.value * 1e8)), lockingBytecode: v.scriptPubKey.hex,
      ...(v.tokenData ? { token: { category: v.tokenData.category, amount: BigInt(v.tokenData.amount ?? 0), nft: v.tokenData.nft } } : {}) };
  }
  async function fund(satoshis: bigint) {
    return output(await rpc<string>('sendtoaddress', [deposit.address, Number(satoshis) / 1e8]), deposit.address);
  }
  async function check(raw: string, name: string, rejection?: RegExp) {
    const [result] = await rpc('testmempoolaccept', [[raw]]);
    evidence.push({ name, result });
    assert.equal(result.allowed, !rejection, `${name}: ${JSON.stringify(result)}`);
    if (rejection) assert.match(result['reject-reason'], rejection, name);
  }
  async function fixture(name: string, seed = 1000000n) {
    const funding = await fund(seed + 20000n);
    const pregen = await new TransactionBuilder({ provider }).addInput(funding, deposit.unlock.spend(signer))
      .addOutput({ to: deposit.address, amount: seed + 10000n }).send();
    const genesisInput = await output(pregen.txid, deposit.address);
    assert.equal(genesisInput.vout, 0);
    const category = pregen.txid;
    const registry = new Contract(artifact, [Buffer.from(category, 'hex').reverse(), BigInt(schedule.epoch), 10n, 3n, 2000n], options);
    let state: Buffer = Buffer.alloc(STATE_SIZE);
    const token = (s: Uint8Array): TokenDetails => ({ category, amount: 0n, nft: { capability: 'mutable', commitment: hashState(s) } });
    const genesis = await new TransactionBuilder({ provider }).addInput(genesisInput, deposit.unlock.spend(signer))
      .addOutput({ to: registry.tokenAddress, amount: seed, token: token(state) }).send();
    let current = await output(genesis.txid, registry.address);
    const genesisTx = await rpc('getrawtransaction', [genesis.txid, true]);
    assert.equal(genesisTx.vout.length, 1);
    assert.equal(current.token!.nft!.commitment, hashState(state));
    assert.equal(current.token!.nft!.capability, 'mutable');
    assert.equal(current.token!.category, category);
    assert.equal(current.satoshis, seed);
    await mine();
    evidence.push({ name: `${name}: fresh genesis`, txid: genesis.txid, category, seed: seed.toString() });
    let expectedValue = seed;
    function accounting() {
      let collateral = 0n;
      for (let i = 0; i < state[5]!; i++) {
        if (state[LIVE + i * RECORD_SIZE + 48] === 0) collateral += BigInt(state.readUInt32LE(LIVE + i * RECORD_SIZE + 33));
      }
      const rewardLiability = BigInt(3 - state.readUInt32LE(0)) * 2000n;
      assert.equal(current.satoshis, expectedValue, 'exact conservation including fees, rewards and collateral');
      assert.ok(current.satoshis >= collateral + rewardLiability + 1000n, 'reserve floor');
      return { period: state.readUInt32LE(0), value: current.satoshis.toString(), collateral: collateral.toString(), rewardLiability: rewardLiability.toString() };
    }
    async function build(action: number, slot = 0, record = Buffer.alloc(0), changes: {
      next?: Buffer; witness?: Buffer; valueDelta?: bigint; payout?: number; locktime?: number;
    } = {}) {
      const next = changes.next ?? nextState(state, action, slot, record, schedule);
      const b = new TransactionBuilder({ provider }).setLocktime(changes.locktime ?? boundary(action === 2 ? state.readUInt32LE(0) : 0))
        .addInput(current, registry.unlock.transition(changes.witness ?? state, BigInt(action), BigInt(slot), record, signer));
      let amount = current.satoshis - 10000n;
      if (action === 0) {
        const stake = BigInt(record.readUInt32LE(33));
        b.addInput(await fund(stake + 10000n), deposit.unlock.spend(signer));
        amount = current.satoshis + stake;
      }
      const payout = changes.payout ?? (action === 3 ? state.readUInt32LE(SNAPSHOT + slot * RECORD_SIZE + 41)
        : action === 4 ? state.readUInt32LE(LIVE + slot * RECORD_SIZE + 33) : 0);
      if (payout) amount -= BigInt(payout);
      b.addOutput({ to: registry.tokenAddress, amount: amount + (changes.valueDelta ?? 0n), token: token(next) });
      if (payout) {
        const address = encodeCashAddress({ prefix: 'bchreg', type: 'p2pkh', payload: hash160(signer.publicKey) });
        if (typeof address === 'string') throw Error(address);
        b.addOutput({ to: address.address, amount: BigInt(payout) });
      }
      return { raw: b.build(), next, action, record, payout };
    }
    async function apply(candidate: Awaited<ReturnType<typeof build>>, label: string) {
      await check(candidate.raw, `${name}: ${label}`);
      const txid = await provider.sendRawTransaction(candidate.raw);
      expectedValue += candidate.action === 0 ? BigInt(candidate.record.readUInt32LE(33)) : -10000n - BigInt(candidate.payout);
      state = candidate.next; current = await output(txid, registry.address);
      evidence.push({ name: `${name}: accounting after ${label}`, txid, ...accounting() });
      return txid;
    }
    return { build, apply, accounting, get state() { return state; }, get current() { return current; } };
  }

  // Late settlement, full-roster authentication and snapshot immutability.
  const late = await fixture('late settlement');
  await late.apply(await late.build(0, 0, offer(signer.publicKey, 1000, 2, 1000, 3)), 'register lower-ranked slot 0');
  await late.apply(await late.build(0, 1, offer(signer.publicKey, 6000, 2, 1000, 3)), 'register higher-ranked slot 1');
  const activation = await late.build(2);
  const omitted = Buffer.from(activation.next); omitted.fill(0, SNAPSHOT + RECORD_SIZE, SNAPSHOT + 2 * RECORD_SIZE);
  await check((await late.build(2, 0, Buffer.alloc(0), { next: omitted })).raw, 'activation cannot omit strictly higher-ranked offer', scriptFailure);
  await late.apply(activation, 'activate after scheduled winner maturity');
  const frozen = Buffer.from(late.state.subarray(SNAPSHOT));
  await check((await late.build(3, 0)).raw, 'complete roster rejects lower-ranked slot 0', scriptFailure);
  const cancel = await late.build(1, 1);
  const altered = Buffer.from(cancel.next); altered[SNAPSHOT + RECORD_SIZE + 47] = 1;
  await check((await late.build(1, 1, Buffer.alloc(0), { next: altered })).raw, 'activated snapshot cannot be modified by cancellation', scriptFailure);
  const reopened = Buffer.from(cancel.next); reopened[4] = 0;
  await check((await late.build(1, 1, Buffer.alloc(0), { next: reopened })).raw, 'activated snapshot cannot reopen phase 0', scriptFailure);
  const replaced = Buffer.from(late.state); replaced[SNAPSHOT + RECORD_SIZE + 47] = 1;
  await check((await late.build(3, 0, Buffer.alloc(0), { witness: replaced })).raw, 'substituted snapshot witness fails authentication', scriptFailure);
  await check((await late.build(2)).raw, 'activated snapshot cannot be replaced by reactivation', scriptFailure);
  await check((await late.build(1, 1, Buffer.alloc(0), { payout: 6000 })).raw, 'cancellation cannot refund activated collateral', scriptFailure);
  const released = Buffer.from(cancel.next); released[LIVE + RECORD_SIZE + 48] = 1;
  await check((await late.build(1, 1, Buffer.alloc(0), { next: released })).raw, 'cancellation cannot mark activated collateral withdrawn', scriptFailure);
  await late.apply(cancel, 'cancel winner after activation');
  assert.deepEqual(late.state.subarray(SNAPSHOT), frozen);
  await check((await late.build(4, 1)).raw, 'mature collateral still held while activated and unsettled', scriptFailure);
  await check((await late.build(5)).raw, 'live cancellation cannot make frozen nonempty snapshot empty', scriptFailure);
  const winner = await late.build(3, 1);
  const skipped = Buffer.from(winner.next); skipped.writeUInt32LE(2);
  await check((await late.build(3, 1, Buffer.alloc(0), { next: skipped })).raw, 'out-of-order settlement cannot skip period 1', scriptFailure);
  const extended = Buffer.from(winner.next); extended.writeUInt32LE(boundary(2) + 1, LIVE + RECORD_SIZE + 49);
  await check((await late.build(3, 1, Buffer.alloc(0), { next: extended })).raw, 'late settlement cannot extend scheduled maturity', scriptFailure);
  const mtpBefore = (await rpc('getblockchaininfo')).mediantime;
  assert.ok(mtpBefore > boundary(2));
  const settlement = await late.apply(winner, 'settle period 0 after maturity');
  assert.equal(late.state.readUInt32LE(LIVE + RECORD_SIZE + 49), boundary(2));
  await check((await late.build(3, 1)).raw, 'current successor cannot settle previous snapshot twice', scriptFailure);
  const restore = await late.build(1, 0);
  const oldPeriod = Buffer.from(restore.next); oldPeriod.writeUInt32LE(0); oldPeriod[4] = 1;
  await check((await late.build(1, 0, Buffer.alloc(0), { next: oldPeriod })).raw,
    'settled snapshot cannot be reopened as its previous period', scriptFailure);
  // Rebuild against the authenticated successor: neither phase nor snapshot is caller-writable.
  const postSettlement = await late.build(1, 0);
  const rewrittenSnapshot = Buffer.from(postSettlement.next); rewrittenSnapshot[SNAPSHOT + RECORD_SIZE + 47] = 1;
  await check((await late.build(1, 0, Buffer.alloc(0), { next: rewrittenSnapshot })).raw,
    'settled audit snapshot remains immutable until next activation', scriptFailure);
  const withdrawal = await late.apply(await late.build(4, 1, Buffer.alloc(0), { locktime: boundary(2) }),
    'immediate withdrawal spends unconfirmed late settlement successor');
  await mine();
  const settledTx = await rpc('getrawtransaction', [settlement, true]);
  const withdrawnTx = await rpc('getrawtransaction', [withdrawal, true]);
  assert.ok(settledTx.confirmations > 0 && withdrawnTx.confirmations > 0);
  assert.equal(settledTx.blockhash, withdrawnTx.blockhash, 'no additional block wait after settlement');
  const block = await rpc('getblockheader', [settledTx.blockhash]);
  const parent = await rpc('getblockheader', [block.previousblockhash]);
  assert.ok(parent.mediantime > boundary(2));
  assert.equal(Math.round(withdrawnTx.vout[1].value * 1e8), 6000);
  await assert.rejects(() => provider.sendRawTransaction(winner.raw), /already|spent|missing|chain/i);
  evidence.push({ name: 'late settlement and withdrawal mined in same block', settlement, withdrawal,
    blockhash: settledTx.blockhash, scheduledMaturity: boundary(2), parentMtp: parent.mediantime,
    maturityExtended: false });

  // Actual repeat-win behavior: three rewards, one deposited S, one latest-maturity record.
  const repeated = await fixture('repeat-win counterexample');
  await repeated.apply(await repeated.build(0, 0, offer(signer.publicKey, 6000, 2, 1000, 3)), 'deposit S exactly once');
  const wins: any[] = [];
  for (let period = 0; period < 3; period++) {
    const activation = await repeated.build(2);
    const jump = Buffer.from(activation.next); jump.writeUInt32LE(period + 1);
    await check((await repeated.build(2, 0, Buffer.alloc(0), { next: jump })).raw, `period ${period}: activation cannot jump cursor`, scriptFailure);
    await repeated.apply(activation, `activate delayed period ${period}`);
    const settlement = await repeated.build(3);
    const rollback = Buffer.from(settlement.next); rollback.writeUInt32LE(period);
    await check((await repeated.build(3, 0, Buffer.alloc(0), { next: rollback })).raw, `period ${period}: settlement cannot retain or roll back cursor`, scriptFailure);
    await check((await repeated.build(3, 0, Buffer.alloc(0), { valueDelta: -1n })).raw, `period ${period}: cannot drain one extra reserve satoshi`, scriptFailure);
    const txid = await repeated.apply(settlement, `settle delayed period ${period}`);
    await check((await repeated.build(3)).raw, `period ${period}: duplicate settlement against successor rejected`, scriptFailure);
    assert.equal(repeated.state.readUInt32LE(LIVE + 49), boundary(period + 2));
    assert.equal(repeated.state[LIVE + 46], period + 1);
    assert.equal(repeated.accounting().collateral, '6000');
    const tx = await rpc('getrawtransaction', [txid, true]);
    assert.equal(tx.vout.length, 2, 'state + reward only, no separate stake allocation output');
    assert.equal(Math.round(tx.vout[1].value * 1e8), 1000);
    wins.push({ period, txid, maturity: boundary(period + 2), outputs: tx.vout.length });
    await mine();
  }
  await repeated.apply(await repeated.build(1), 'cancel after three wins');
  await repeated.apply(await repeated.build(4, 0, Buffer.alloc(0), { locktime: boundary(4) }), 'single S withdrawal after all three wins');
  assert.equal(repeated.accounting().rewardLiability, '0');
  assert.equal(repeated.accounting().collateral, '0');
  assert.equal(repeated.current.satoshis, 917000n, 'three rewards, all fees and one S refund reconcile exactly');
  await check((await repeated.build(4)).raw, 'cannot withdraw a second independent allocation because none exists', scriptFailure);
  await mine();
  evidence.push({ name: 'UNMET REQUIREMENT: separate allocation per win', wins, depositedStake: 6000,
    peakAccountedCollateral: 6000, separateAllocations: false, actualModel: 'one pooled stake; latest maturity overwrites earlier maturity' });

  // Reward reserve is not a fee budget: this deliberately underprovisioned instance stalls safely.
  const tight = await fixture('fee-budget boundary', 17000n); // 3*2000 + 1000 floor + one activation fee.
  await tight.apply(await tight.build(0, 0, offer(signer.publicKey, 6000, 2, 1000, 3)), 'register');
  await tight.apply(await tight.build(2), 'activation consumes final excess fee budget');
  assert.equal(tight.current.satoshis, 13000n);
  assert.equal(tight.accounting().rewardLiability, '6000');
  await check((await tight.build(3)).raw, 'settlement rejected when fee would breach future reward reserve', scriptFailure);
  evidence.push({ name: 'LIMITATION: fee exhaustion can strand an activated instance', ...tight.accounting(), topUpBranch: false });
  const after = await rpc('getblockchaininfo');
  assert.ok(after.blocks > before.blocks);
  assert.equal(await rpc('getblockhash', [before.blocks]), before.bestblockhash, 'previous development chain preserved');
  await writeFile('docs/registry-verification-result.json', JSON.stringify({
    verifiedAt: new Date().toISOString(), node: await rpc('getnetworkinfo'), schedule,
    before: { height: before.blocks, hash: before.bestblockhash }, after: { height: after.blocks, hash: after.bestblockhash },
    accepted: evidence.filter(e => e.result?.allowed === true).length,
    rejected: evidence.filter(e => e.result?.allowed === false).length, evidence,
  }, null, 2) + '\n');
});
