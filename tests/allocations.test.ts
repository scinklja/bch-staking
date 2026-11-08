import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { binToHex, cashAddressToLockingBytecode, encodeCashAddress, hash160 } from '@bitauth/libauth';
import { Contract, SignatureTemplate, TransactionBuilder, type SpendableUtxo, type TokenDetails } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { TokenRegtestProvider } from '../src/token-provider.js';
import { allocationTerms, hashState, LIVE, nextState, offer, periodBoundary, RECORD_SIZE, remainingCommitment, SNAPSHOT, STATE_SIZE } from '../src/registry.js';

test('independent CashToken allocations: three wins, immutable locks, escrow, snapshots and delayed settlement', { timeout: 300000 }, async () => {
  await assertRegtest();
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  const checkpoint = await rpc('getblockchaininfo');
  const provider = new TokenRegtestProvider();
  const options = { provider, contractType: 'p2sh32' as const };
  const artifacts: Record<string, any> = {};
  for (const name of ['Registry', 'RegistryDeposit', 'StakePool', 'StakeAllocation']) {
    artifacts[name] = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
  }
  const owners = Array.from({ length: 16 }, (_, i) => new SignatureTemplate(new Uint8Array(32).fill(100 + i)));
  const depositor = owners[0]!;
  const deposit = new Contract(artifacts.RegistryDeposit, [depositor.publicKey], options);
  const mining = await rpc<string>('getnewaddress');
  const evidence: any[] = [];
  const confirmedIds: string[] = [];
  const scriptFailure = /(?:non-)?mandatory-script-verify/;
  const mine = (n = 1) => rpc('generatetoaddress', [n, mining]);
  function script(address: string) {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw Error(decoded);
    return binToHex(decoded.bytecode);
  }
  function payee(owner: SignatureTemplate) {
    const address = encodeCashAddress({ prefix: 'bchreg', type: 'p2pkhWithTokens', payload: hash160(owner.publicKey) });
    if (typeof address === 'string') throw Error(address);
    return address.address;
  }
  async function out(txid: string, index: number): Promise<SpendableUtxo> {
    const tx = await rpc('getrawtransaction', [txid, true]);
    const v = tx.vout[index]; assert.ok(v);
    return { txid, vout: index, satoshis: BigInt(Math.round(v.value * 1e8)), lockingBytecode: v.scriptPubKey.hex,
      ...(v.tokenData ? { token: { category: v.tokenData.category, amount: BigInt(v.tokenData.amount ?? 0), nft: v.tokenData.nft } } : {}) };
  }
  async function fundBch(amount: bigint) {
    const id = await rpc<string>('sendtoaddress', [deposit.address, Number(amount) / 1e8]);
    const tx = await rpc('getrawtransaction', [id, true]);
    return out(id, tx.vout.findIndex((v: any) => v.scriptPubKey.hex === script(deposit.address)));
  }
  async function check(raw: string, name: string, reason?: RegExp) {
    const [result] = await rpc('testmempoolaccept', [[raw]]);
    evidence.push({ name, result });
    assert.equal(result.allowed, !reason, `${name}: ${JSON.stringify(result)}`);
    if (reason) assert.match(result['reject-reason'], reason, name);
  }
  async function send(raw: string) {
    const txid = await provider.sendRawTransaction(raw); confirmedIds.push(txid); return txid;
  }
  // Mint a finite real fungible-token supply; no minting NFT is created or retained.
  async function asset() {
    const funding = await fundBch(10020000n);
    const pregen = await new TransactionBuilder({ provider }).addInput(funding, deposit.unlock.spend(depositor))
      .addOutput({ to: deposit.address, amount: 10010000n }).send();
    const category = pregen.txid;
    assert.equal((await out(pregen.txid, 0)).vout, 0);
    const genesis = await new TransactionBuilder({ provider }).addInput(await out(category, 0), deposit.unlock.spend(depositor))
      .addOutput({ to: deposit.tokenAddress, amount: 10000000n, token: { category, amount: 1000000000n } }).send();
    let supply = await out(genesis.txid, 0);
    async function fundingTokens(amount: bigint) {
      const raw = new TransactionBuilder({ provider }).addInput(supply, deposit.unlock.spend(depositor))
        .addOutput({ to: deposit.tokenAddress, amount: 10000n, token: { category, amount } })
        .addOutput({ to: deposit.tokenAddress, amount: supply.satoshis - 20000n,
          token: { category, amount: supply.token!.amount - amount } }).build();
      const txid = await send(raw); supply = await out(txid, 1); return out(txid, 0);
    }
    await mine();
    return { category, fundingTokens };
  }
  const tokens = await asset();
  const otherTokens = await asset();
  type Schedule = { epoch: number; periodSeconds: number };
  async function fixture(label: string, schedule: Schedule, periods = 4, cap = 2000, seed = 2000000n) {
    const funding = await fundBch(seed + 21000n);
    const pregen = await new TransactionBuilder({ provider }).addInput(funding, deposit.unlock.spend(depositor))
      .addOutput({ to: deposit.address, amount: seed + 11000n }).send();
    const category = pregen.txid;
    const categoryBytes = Buffer.from(category, 'hex').reverse();
    const assetBytes = Buffer.from(tokens.category, 'hex').reverse();
    const registry = new Contract(artifacts.Registry, [categoryBytes, assetBytes, BigInt(schedule.epoch),
      BigInt(schedule.periodSeconds), BigInt(periods), BigInt(cap)], options);
    const pool = new Contract(artifacts.StakePool, [Buffer.concat([categoryBytes, assetBytes])], options);
    let state: Buffer = Buffer.alloc(STATE_SIZE);
    const stateToken = (s: Uint8Array): TokenDetails => ({ category, amount: 0n, nft: { capability: 'mutable', commitment: hashState(s) } });
    const genesis = await new TransactionBuilder({ provider }).addInput(await out(category, 0), deposit.unlock.spend(depositor))
      .addOutput({ to: registry.tokenAddress, amount: seed, token: stateToken(state) })
      .addOutput({ to: pool.address, amount: 1000n }).send();
    let current = await out(genesis.txid, 0); let escrow = await out(genesis.txid, 1);
    let expectedBch = seed;
    const boundary = (p: number) => periodBoundary(schedule, p);
    const allocations: { contract: Contract; utxo: SpendableUtxo; terms: Buffer; slot: number; period: number }[] = [];
    const poolToken = (amount: bigint, cat = tokens.category) => amount ? { category: cat, amount } : undefined;
    function lock(slot: number, period: number, record: Buffer) {
      const terms = allocationTerms(record.subarray(0,33), category, tokens.category, slot, period,
        record.readUInt32LE(33), boundary(period + record.readUInt32LE(37)));
      return { terms, contract: new Contract(artifacts.StakeAllocation, [terms], options) };
    }
    async function build(action: number, slot = 0, record = Buffer.alloc(0), changes: {
      next?: Buffer; witness?: Buffer; funding?: SpendableUtxo; allocationTerms?: Buffer;
      allocationAmount?: bigint; allocationValue?: bigint; allocationCategory?: string; poolAmount?: bigint;
      poolCategory?: string; refundAmount?: bigint; valueDelta?: bigint; rewardDelta?: bigint; owner?: SignatureTemplate; locktime?: number;
    } = {}) {
      const next = changes.next ?? nextState(state, action, slot, record);
      const b = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
        .setLocktime(changes.locktime ?? (action === 2 ? boundary(state.readUInt32LE(0)) : (await rpc('getblockchaininfo')).mediantime - 1))
        .addInput(current, registry.unlock.transition(changes.witness ?? state, BigInt(action), BigInt(slot), record, changes.owner ?? owners[slot]!))
        .addInput(escrow, pool.unlock.spend());
      if (action === 0) b.addInput(changes.funding ?? await tokens.fundingTokens(BigInt(record.readUInt32LE(33)) * BigInt(record[45]!)), deposit.unlock.spend(depositor));
      const selected = Buffer.from(state.subarray((action === 3 ? SNAPSHOT : LIVE) + slot * RECORD_SIZE,
        (action === 3 ? SNAPSHOT : LIVE) + (slot + 1) * RECORD_SIZE));
      const payout = action === 3 ? BigInt(selected.readUInt32LE(41)) : 0n;
      const refund = changes.refundAmount ?? (action === 4 ? BigInt(selected.readUInt32LE(33)) * BigInt(selected[45]! - selected[46]!) : 0n);
      const amount = action === 0 ? current.satoshis : current.satoshis - 10000n - payout - (action === 3 ? 2000n : action === 4 ? 1000n : 0n);
      b.addOutput({ to: registry.tokenAddress, amount: amount + (changes.valueDelta ?? 0n), token: stateToken(next) });
      b.addOutput({ to: pool.tokenAddress, amount: 1000n, token: poolToken(changes.poolAmount ?? remainingCommitment(next), changes.poolCategory) });
      let allocation: ReturnType<typeof lock> | undefined;
      if (action === 3) {
        b.addOutput({ to: payee(owners[slot]!), amount: payout + (changes.rewardDelta ?? 0n) });
        allocation = lock(slot, state.readUInt32LE(0), selected);
        if (changes.allocationTerms) allocation = { terms: changes.allocationTerms, contract: new Contract(artifacts.StakeAllocation, [changes.allocationTerms], options) };
        b.addOutput({ to: allocation.contract.tokenAddress, amount: changes.allocationValue ?? 2000n,
          token: { category: changes.allocationCategory ?? tokens.category, amount: changes.allocationAmount ?? BigInt(selected.readUInt32LE(33)) } });
      }
      if (action === 4) b.addOutput({ to: payee(owners[slot]!), amount: 1000n, token: poolToken(refund) });
      return { raw: b.build(), next, action, amount, allocation, slot, period: state.readUInt32LE(0), payout, refund };
    }
    async function apply(candidate: Awaited<ReturnType<typeof build>>, name: string) {
      await check(candidate.raw, `${label}: ${name}`);
      const txid = await send(candidate.raw);
      state = candidate.next; current = await out(txid, 0); escrow = await out(txid, 1);
      expectedBch += candidate.action === 0 ? 0n : -10000n - candidate.payout - (candidate.action === 3 ? 2000n : candidate.action === 4 ? 1000n : 0n);
      assert.equal(current.satoshis, expectedBch);
      assert.equal(escrow.token?.amount ?? 0n, remainingCommitment(state));
      assert.ok(current.satoshis >= BigInt(periods - state.readUInt32LE(0)) * BigInt(cap) + 1000n);
      if (candidate.allocation) allocations.push({ ...candidate.allocation, utxo: await out(txid, 3), slot: candidate.slot, period: candidate.period });
      evidence.push({ name: `${label}: accounting`, txid, period: state.readUInt32LE(0), bch: current.satoshis.toString(),
        remainingTokens: remainingCommitment(state).toString(), remainingRewardCaps: (periods - state.readUInt32LE(0)) * cap });
      return txid;
    }
    async function activate() {
      const p = state.readUInt32LE(0);
      while (Date.now() / 1000 <= boundary(p) + 2) await new Promise(resolve => setTimeout(resolve, 250));
      await mine(12);
      assert.ok((await rpc('getblockchaininfo')).mediantime > boundary(p));
      await apply(await build(2), `activate period ${p}`);
    }
    await mine();
    evidence.push({ name: `${label}: canonical fresh genesis`, txid: genesis.txid, category, stakingCategory: tokens.category, schedule });
    return { build, apply, activate, allocations, boundary, category, registry, pool,
      get state() { return state; }, get current() { return current; }, get escrow() { return escrow; } };
  }
  function withdraw(a: { contract: Contract; utxo: SpendableUtxo; terms: Buffer }, changes: {
    owner?: SignatureTemplate; locktime?: number; terms?: Buffer; tokenCategory?: string; amount?: bigint;
  } = {}) {
    const contract = changes.terms ? new Contract(artifacts.StakeAllocation, [changes.terms], options) : a.contract;
    const unlocker = contract.unlock.withdraw(changes.owner ?? owners[0]!);
    const b = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .setLocktime(changes.locktime ?? a.terms.readUInt32LE(74))
      .addInput(a.utxo, changes.terms ? { generateUnlockingBytecode: unlocker.generateUnlockingBytecode } : unlocker)
      .addOutput({ to: payee(owners[0]!), amount: 1000n,
        token: { category: changes.tokenCategory ?? tokens.category, amount: changes.amount ?? a.utxo.token!.amount } });
    return b.build();
  }

  // Register all sixteen slots and rank the entire immutable roster as before.
  const now = Math.max(Date.now() / 1000, (await rpc('getblockchaininfo')).mediantime);
  console.log('Allocation verification: token genesis ready');
  const f = await fixture('live allocations', { epoch: Math.floor(now / 60) * 60, periodSeconds: 60 });
  const records = owners.map((owner, i) => offer(owner.publicKey, i === 0 || i === 15 ? 6000 : 1000, 3, 1000, i === 0 ? 3 : 2));
  const wrongDeposit = await otherTokens.fundingTokens(18000n);
  await check((await f.build(0, 0, records[0]!, { funding: wrongDeposit, poolCategory: otherTokens.category })).raw,
    'registration rejects genuine tokens of a substituted category', scriptFailure);
  await check((await f.build(0, 1, records[0]!)).raw, 'registration sequence must equal authenticated count', scriptFailure);
  await check((await f.build(0, 0, records[0]!, { funding: await tokens.fundingTokens(6000n), poolAmount: 6000n })).raw,
    'registration requires full S times W commitment', /bad-txns-token|mandatory-script/);
  for (let i = 0; i < 16; i++) {
    await f.apply(await f.build(0, i, records[i]!), `register slot ${i} with S*W`);
    await mine();
  }
  assert.equal(f.state[5], 16);
  console.log('Allocation verification: all sixteen commitments registered');
  const initialPool = remainingCommitment(f.state);
  await check((await f.build(0, 16, records[0]!, { owner: owners[0] })).raw, 'capacity cannot exceed sixteen lifetime registrations', scriptFailure);
  const theftFunding = await fundBch(20000n);
  const theft = new TransactionBuilder({ provider }).addInput(theftFunding, deposit.unlock.spend(depositor))
    .addInput(f.escrow, f.pool.unlock.spend()).addOutput({ to: payee(depositor), amount: 11000n,
      token: { category: tokens.category, amount: initialPool } }).build();
  await check(theft, 'pool cannot spend without canonical registry NFT input', scriptFailure);
  await f.activate();
  const frozen = Buffer.from(f.state.subarray(SNAPSHOT));
  const forged = Buffer.from(f.state); forged.fill(0, SNAPSHOT, SNAPSHOT + RECORD_SIZE);
  await check((await f.build(3, 1, Buffer.alloc(0), { witness: forged })).raw, 'cannot omit strictly higher-ranked snapshot entry', scriptFailure);
  await check((await f.build(3, 1)).raw, 'complete roster rejects lower-ranked winner', scriptFailure);
  await check((await f.build(3, 15)).raw, 'later canonical registration loses exact-score tie', scriptFailure);
  const c = await f.build(1, 1);
  const tampered = Buffer.from(c.next); tampered[SNAPSHOT + RECORD_SIZE + 47] = 1;
  await check((await f.build(1, 1, Buffer.alloc(0), { next: tampered })).raw, 'cancellation cannot modify activated snapshot', scriptFailure);
  const reopened = Buffer.from(c.next); reopened[4] = 0;
  await check((await f.build(1, 1, Buffer.alloc(0), { next: reopened })).raw, 'cannot reopen activated snapshot', scriptFailure);
  await check((await f.build(2)).raw, 'cannot replace activated snapshot', scriptFailure);
  await check((await f.build(1, 1, Buffer.alloc(0), { owner: owners[0] })).raw, 'unauthorized cancellation rejected', scriptFailure);
  await f.apply(c, 'cancel losing offer after activation');
  assert.deepEqual(f.state.subarray(SNAPSHOT), frozen);
  assert.equal(remainingCommitment(f.state), initialPool, 'losing/cancellation consumes no stake');
  await check((await f.build(4, 1)).raw, 'cancellation cannot release activated unsettled escrow', scriptFailure);
  await check((await f.build(5)).raw, 'cannot skip nonempty frozen roster', scriptFailure);
  const valid = await f.build(3, 0);
  assert.ok(valid.allocation);
  for (const [offset, name] of [[0, 'owner'], [33, 'vault ID'], [65, 'offer ID'], [66, 'winning period'], [70, 'stake amount'], [74, 'maturity'], [78, 'asset category']] as const) {
    const terms = Buffer.from(valid.allocation.terms); terms[offset] = terms[offset]! ^ 1;
    await check((await f.build(3, 0, Buffer.alloc(0), { allocationTerms: terms })).raw, `allocation cannot forge ${name}`, scriptFailure);
  }
  await check((await f.build(3, 0, Buffer.alloc(0), { allocationAmount: 5999n, poolAmount: initialPool - 5999n })).raw,
    'underfunded allocation rejected even with conserved total tokens', scriptFailure);
  await check((await f.build(3, 0, Buffer.alloc(0), { allocationValue: 1999n, valueDelta: 1n })).raw,
    'underfunded allocation BCH carrier rejected', scriptFailure);
  await check((await f.build(3, 0, Buffer.alloc(0), { rewardDelta: -1n, valueDelta: 1n })).raw, 'reward cannot be underpaid', scriptFailure);
  const noDeduction = Buffer.from(valid.next); noDeduction[LIVE + 46] = 0;
  await check((await f.build(3, 0, Buffer.alloc(0), { next: noDeduction, poolAmount: initialPool - 6000n })).raw, 'win cannot avoid escrow deduction or reuse stake', /bad-txns-token|mandatory-script/);
  const jump = Buffer.from(valid.next); jump.writeUInt32LE(2);
  await check((await f.build(3, 0, Buffer.alloc(0), { next: jump })).raw, 'out-of-order settlement rejected', scriptFailure);
  await check((await f.build(3, 0, Buffer.alloc(0), { valueDelta: -1n })).raw, 'reserve cannot lose an extra satoshi', scriptFailure);
  await f.apply(valid, 'settle period 0 creates allocation 0 and immediate reward');
  await check((await f.build(3, 0)).raw, 'cannot settle period 0 twice', scriptFailure);
  await f.apply(await f.build(4, 1), 'refund all never-winning S*W after settlement');
  for (let period = 1; period < 3; period++) {
    await f.activate();
    await f.apply(await f.build(3, 0), `settle period ${period} creates independent allocation`);
    await mine();
  }
  console.log('Allocation verification: three independent allocations settled');
  const [a0, a1, a2] = f.allocations;
  assert.ok(a0 && a1 && a2);
  assert.equal(new Set(f.allocations.map(a => `${a.utxo.txid}:${a.utxo.vout}`)).size, 3);
  for (let i = 0; i < 3; i++) {
    const a = f.allocations[i]!;
    assert.equal(a.terms.readUInt32LE(74), f.boundary(i + 3));
    assert.equal(a.utxo.token!.amount, 6000n);
    assert.equal(a.contract.bytecode.slice(0, 4), '4c6e', 'canonical 110-byte constructor push');
  }
  assert.equal(f.state[LIVE + 46], 3);
  assert.equal(remainingCommitment(f.state), initialPool - 18000n - 2000n);
  const currentMtp = (await rpc('getblockchaininfo')).mediantime;
  assert.ok(currentMtp < f.boundary(3), 'first allocation still immature after three wins');
  await check(withdraw(a0), 'unmatured allocation cannot withdraw with future locktime', /nonfinal/);
  await check(withdraw(a0, { locktime: f.boundary(0) }), 'backdated locktime cannot bypass maturity', /Locktime requirement not satisfied/);
  const changedMaturity = Buffer.from(a0.terms); changedMaturity.writeUInt32LE(f.boundary(0), 74);
  await check(withdraw(a0, { terms: changedMaturity, locktime: f.boundary(0) }), 'existing allocation maturity cannot be changed by replacing redeem script', scriptFailure);
  await f.activate(); // Period 3 remains unsettled while allocation 0 is withdrawn.
  const mtp = (await rpc('getblockchaininfo')).mediantime;
  assert.ok(mtp > f.boundary(3) && mtp < f.boundary(4));
  await check(withdraw(a0, { owner: owners[1] }), 'allocation withdrawal requires its owner signature', scriptFailure);
  await check(withdraw(a0, { amount: 5999n }), 'allocation withdrawal cannot burn or divert stake', scriptFailure);
  const raw0 = withdraw(a0);
  await check(raw0, 'first matured allocation withdraws with unrelated period activated and unsettled');
  const withdrawn0 = await send(raw0); await mine();
  await assert.rejects(() => provider.sendRawTransaction(raw0), /already|spent|missing|chain/i);
  evidence.push({ name: 'duplicate allocation withdrawal rejected after confirmation', txid: withdrawn0 });
  for (const a of [a1, a2]) {
    assert.ok(await rpc('gettxout', [a.utxo.txid, a.utxo.vout, true]));
    await check(withdraw(a), `allocation ${a.period} remains independently immature`, /nonfinal/);
  }
  assert.equal(f.state[4], 1, 'withdrawal did not settle or mutate the unrelated activated period');
  await f.apply(await f.build(1, 15), 'cancel current frozen winner for future periods only');
  await check((await f.build(4, 15)).raw, 'activated winner commitment cannot be refunded before settlement', scriptFailure);
  await check((await f.build(3, 0)).raw, 'exhausted maximum wins prevents fourth win', scriptFailure);
  await f.apply(await f.build(3, 15), 'frozen late-cancelled winner still receives allocation and reward');
  await f.apply(await f.build(4, 15), 'refund only unallocated remainder after activated win');
  await mine();
  evidence.push({ name: 'three independent wins', vault: f.category, allocations: [a0, a1, a2].map(a => ({
    id: `${a.utxo.txid}:${a.utxo.vout}`, terms: a.terms.toString('hex'), owner: binToHex(owners[0]!.publicKey), offer: a.slot,
    period: a.period, tokens: a.utxo.token!.amount.toString(), maturity: a.terms.readUInt32LE(74), address: a.contract.tokenAddress,
  })), firstWithdrawal: withdrawn0, otherAllocationsRemainLocked: true });

  // Fully elapsed schedule: reward, stake allocation and its withdrawal may confirm together.
  const info = await rpc('getblockchaininfo');
  const late = await fixture('late settlement', { epoch: Math.floor((info.mediantime - 10000) / 10) * 10, periodSeconds: 10 }, 3);
  const record = offer(owners[0]!.publicKey, 6000, 2, 1000, 3);
  await late.apply(await late.build(0, 0, record), 'commit 18000 tokens');
  await late.activate();
  await late.apply(await late.build(1, 0), 'cancel future eligibility while preserving activated liability');
  await check((await late.build(4, 0)).raw, 'late activated liability still blocks commitment refund', scriptFailure);
  const lateSettlement = await late.apply(await late.build(3, 0), 'settle period 0 after scheduled maturity');
  const allocation = late.allocations[0]!;
  assert.equal(allocation.terms.readUInt32LE(74), late.boundary(2));
  const lateWithdrawal = withdraw(allocation);
  await check(lateWithdrawal, 'late allocation withdraws immediately from unconfirmed settlement');
  const lateRefund = await send(lateWithdrawal);
  await late.apply(await late.build(4, 0), 'refund exactly 12000 unallocated tokens');
  await check((await late.build(4, 0, Buffer.alloc(0), { refundAmount: 0n })).raw, 'duplicate commitment refund rejected', scriptFailure);
  await mine();
  const settled = await rpc('getrawtransaction', [lateSettlement, true]);
  const refunded = await rpc('getrawtransaction', [lateRefund, true]);
  assert.equal(settled.blockhash, refunded.blockhash);
  const header = await rpc('getblockheader', [settled.blockhash]);
  const parent = await rpc('getblockheader', [header.previousblockhash]);
  assert.ok(parent.mediantime > late.boundary(2));
  evidence.push({ name: 'late settlement and independent withdrawal in same block', settlement: lateSettlement,
    withdrawal: lateRefund, blockhash: settled.blockhash, scheduledMaturity: late.boundary(2), parentMtp: parent.mediantime });
  for (let p = 1; p < 3; p++) { await late.activate(); await late.apply(await late.build(5), `advance empty period ${p}`); }
  await check((await late.build(2)).raw, 'finite horizon prevents extra activation', scriptFailure);
  await mine();
  for (const txid of confirmedIds) assert.ok((await rpc('getrawtransaction', [txid, true])).confirmations > 0, txid);
  assert.equal(await rpc('getblockhash', [checkpoint.blocks]), checkpoint.bestblockhash, 'existing development chain preserved');
  await writeFile('docs/allocations-test-result.json', JSON.stringify({ verifiedAt: new Date().toISOString(), node: (await rpc('getnetworkinfo')).subversion,
    before: { height: checkpoint.blocks, hash: checkpoint.bestblockhash }, after: await rpc('getblockchaininfo'),
    accepted: evidence.filter(e => e.result?.allowed === true).length, rejected: evidence.filter(e => e.result?.allowed === false).length,
    confirmedTransactions: confirmedIds.length, registryBytes: f.registry.bytesize, poolBytes: f.pool.bytesize,
    allocationBytes: a0.contract.bytesize, stateBytes: STATE_SIZE, evidence }, null, 2) + '\n');
});
