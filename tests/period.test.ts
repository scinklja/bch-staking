import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { Contract, SignatureTemplate, TransactionBuilder, type SpendableUtxo } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { RegtestProvider } from '../src/provider.js';

test('deadline counterexample and irrevocable OPEN -> CLOSED -> SETTLED', { timeout: 180000 }, async () => {
  await assertRegtest();
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  const provider = new RegtestProvider();
  const artifacts = Object.fromEntries(await Promise.all(['DeadlineProbe', 'PeriodOpen', 'Vault', 'StakeLock'].map(async name =>
    [name, JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'))])));
  const opts = { provider, contractType: 'p2sh32' as const };
  const destination = await rpc<string>('getnewaddress');
  function script(address: string) {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw Error(decoded);
    return decoded.bytecode;
  }
  const info = await rpc('getblockchaininfo');
  // Fixed UTC 10-second grid, with enough time to test pre-cutoff actions.
  // Use real clock and normal mining: no mocktime changes or chain reset.
  const cutoff = Math.ceil((Math.max(Math.floor(Date.now() / 1000), info.mediantime) + 60) / 10) * 10;
  const signer = new SignatureTemplate(new Uint8Array(32).fill(7)); // public regtest fixture key only
  const payees = await Promise.all([0, 1, 2].map(() => rpc<string>('getnewaddress')));
  const stakes = [20000n, 30000n, 10000n];
  const rewards = [2000n, 3000n, 2000n];
  const locks = payees.map(p => new Contract(artifacts.StakeLock, [BigInt(cutoff + 10000), script(p)], opts));
  const args: any[] = [BigInt(cutoff), 5000n, 10000n, script(destination)];
  for (let i = 0; i < 3; i++) args.push(stakes[i], 10000n, rewards[i], script(payees[i]!), script(locks[i]!.address));
  const closed = new Contract(artifacts.Vault, args, opts);
  const open = new Contract(artifacts.PeriodOpen, [BigInt(cutoff), script(closed.address)], opts);
  const probe = new Contract(artifacts.DeadlineProbe, [BigInt(cutoff), signer.publicKey, script(destination), script(closed.address)], opts);
  const evidence: unknown[] = [{ cutoff, initialMtp: info.mediantime, clockControl: 'normal clock, no setmocktime' }];
  async function mine() { await rpc('generatetoaddress', [1, destination]); }
  async function fund(contract: Contract, satoshis: bigint) {
    const txid = await rpc<string>('sendtoaddress', [contract.address, Number(satoshis) / 1e8]);
    await mine();
    const utxo = (await contract.getUtxos()).find(u => u.txid === txid);
    assert.ok(utxo);
    return utxo;
  }
  async function check(raw: string, name: string, reason?: RegExp) {
    const [result] = await rpc('testmempoolaccept', [[raw]]);
    assert.equal(result.allowed, !reason, name);
    if (reason) assert.match(result['reject-reason'], reason, name);
    evidence.push({ name, mtp: (await rpc('getblockchaininfo')).mediantime, result });
  }
  async function broadcastAndMine(raw: string, name: string, when?: 'before' | 'after') {
    const txid = await provider.sendRawTransaction(raw);
    await mine();
    const tx = await rpc('getrawtransaction', [txid, true]);
    assert.ok(tx.confirmations >= 1, name);
    const containing = await rpc('getblockheader', [tx.blockhash]);
    const previous = await rpc('getblockheader', [containing.previousblockhash]);
    if (when === 'before') {
      assert.ok(previous.mediantime < cutoff, name + ': parent MTP before cutoff');
      assert.ok(Date.now() / 1000 < cutoff, name + ': wall clock before cutoff');
    }
    if (when === 'after') assert.ok(previous.mediantime > cutoff, name + ': parent MTP after cutoff');
    evidence.push({ name, txid, confirmations: tx.confirmations, previousBlockMtp: previous.mediantime, observedWallTime: Math.floor(Date.now() / 1000) });
    return txid;
  }
  const pre = await fund(probe, 5000n);
  const late = await fund(probe, 5000n);
  const state = await fund(open, 72000n); // 71000 closed vault + close fee
  const cancellation = (u: SpendableUtxo, locktime: number) => new TransactionBuilder({ provider })
    .setLocktime(locktime).addInput(u, probe.unlock.cancel(signer))
    .addOutput({ to: destination, amount: u.satoshis - 1000n }).build();
  assert.ok((await rpc('getblockchaininfo')).mediantime < cutoff, 'pre-cutoff fixture');
  assert.ok(Date.now() / 1000 < cutoff, 'wall clock also before cutoff');
  // Use an actually old timestamp, so cancellation is already final.
  const oldTime = info.mediantime - 1;
  assert.ok(oldTime < cutoff);
  await check(cancellation(pre, oldTime), 'authorized cancellation before cutoff');
  await broadcastAndMine(cancellation(pre, oldTime), 'pre-cutoff cancellation confirmed', 'before');
  const preClose = new TransactionBuilder({ provider }).setLocktime(cutoff)
    .addInput(state, open.unlock.close()).addOutput({ to: closed.address, amount: 71000n });
  await check(preClose.build(), 'closure before cutoff', /nonfinal/);
  const redirect = new TransactionBuilder({ provider }).setLocktime(oldTime)
    .addInput(state, open.unlock.close()).addOutput({ to: destination, amount: 71000n });
  await check(redirect.build(), 'irrevocable active offer cannot cancel before cutoff', /OP_EQUALVERIFY/);
  // Wait on the actual clock. This deliberately leaves OPEN unspent after cutoff.
  while (Date.now() / 1000 <= cutoff + 12) await new Promise(resolve => setTimeout(resolve, 250));
  await rpc('generatetoaddress', [12, destination]);
  const delayed = await rpc('getblockchaininfo');
  assert.ok(delayed.mediantime > cutoff, 'chain MTP crossed cutoff');
  evidence.push({ name: 'delayed closure; OPEN still unspent', mtp: delayed.mediantime,
    delaySeconds: delayed.mediantime - cutoff });
  assert.ok(await rpc('gettxout', [state.txid, state.vout, true]));
  // Construct AND sign this cancellation only now, after cutoff (not merely pre-signing).
  await check(cancellation(late, oldTime), 'UNSAFE late cancellation before close accepted');
  await broadcastAndMine(cancellation(late, oldTime), 'UNSAFE late cancellation mined after cutoff', 'after');
  // Use a fresh unspent output so spent-input rejection cannot mask the script check.
  const boundary = await fund(probe, 5000n);
  await check(cancellation(boundary, cutoff), 'declared locktime at cutoff rejected', /OP_VERIFY|OP_LESSTHAN/);
  const lateRedirect = redirect.setLocktime(cutoff).build();
  await check(lateRedirect, 'active cancellation after cutoff before close rejected', /OP_EQUALVERIFY/);
  const closeRaw = preClose.build();
  await check(closeRaw, 'permissionless delayed closure allowed');
  const closeId = await broadcastAndMine(closeRaw, 'OPEN -> CLOSED confirmed', 'after');
  const closedUtxo = (await closed.getUtxos()).find(u => u.txid === closeId)!;
  assert.ok(closedUtxo);
  const settle = (winner: number) => {
    const b = new TransactionBuilder({ provider }).setLocktime(cutoff).addInput(closedUtxo, closed.unlock.settle(BigInt(winner)))
      .addOutput({ to: payees[winner]!, amount: rewards[winner]! });
    for (let i = 0; i < 3; i++) b.addOutput({ to: i === winner ? locks[i]!.address : payees[i]!, amount: stakes[i]! });
    return b.addOutput({ to: destination, amount: 10000n - rewards[winner]! });
  };
  const reopen = new TransactionBuilder({ provider }).setLocktime(cutoff).addInput(closedUtxo, closed.unlock.settle(0n))
    .addOutput({ to: open.address, amount: 70000n });
  await check(reopen.build(), 'CLOSED -> OPEN forbidden', /OP_NUMEQUALVERIFY/);
  await check(settle(2).build(), 'lower-ranked offer after delayed close rejected', /OP_VERIFY/);
  await check(settle(1).build(), 'later tied offer after delayed close rejected', /OP_VERIFY/);
  await check(settle(0).build(), 'permissionless settlement after delayed close');
  const settledId = await broadcastAndMine(settle(0).build(), 'CLOSED -> SETTLED terminal confirmed', 'after');
  assert.equal(await rpc('gettxout', [closedUtxo.txid, closedUtxo.vout, true]), null);
  const payout = await rpc('getrawtransaction', [settledId, true]);
  assert.equal(Math.round(payout.vout[0].value * 1e8), 2000);
  await writeFile('docs/period-test-result.json', JSON.stringify(evidence, null, 2) + '\n');
});
