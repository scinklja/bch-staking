import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { Contract, TransactionBuilder } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { RegtestProvider } from '../src/provider.js';

test('bounded vault: BCHN consensus ranking, ties, reserves, payout, locks and replay', async () => {
  await assertRegtest();
  const provider = new RegtestProvider();
  const artifact = JSON.parse(await readFile('artifacts/Vault.json', 'utf8'));
  const lockArtifact = JSON.parse(await readFile('artifacts/StakeLock.json', 'utf8'));
  const address = await rpc<string>('getnewaddress');
  const decode = (a: string) => {
    const result = cashAddressToLockingBytecode(a);
    if (typeof result === 'string') throw Error(result);
    return result.bytecode;
  };
  const block = await rpc('getblockchaininfo');
  const start = BigInt(block.mediantime - 100);
  const payees = await Promise.all([0, 1, 2].map(() => rpc<string>('getnewaddress')));
  const stakes = [20000n, 30000n, 10000n];
  const durations = [10000n, 10000n, 10000n];
  // Offers 0 and 1 tie exactly; offer 2 loses.
  const rewards = [2000n, 3000n, 2000n];
  const locks = payees.map((p, i) => new Contract(lockArtifact,
    [start + durations[i]!, decode(p)], { provider, contractType: 'p2sh32' }));
  const reports: unknown[] = [];
  async function setup(reserve: bigint, rs = rewards, boundary = start) {
    const args: any[] = [boundary, 5000n, reserve, decode(address)];
    for (let i = 0; i < 3; i++) args.push(stakes[i], durations[i], rs[i], decode(payees[i]!), decode(locks[i]!.address));
    const vault = new Contract(artifact, args, { provider, contractType: 'p2sh32' });
    const total = reserve + 61000n;
    const funding = await rpc<string>('sendtoaddress', [vault.address, Number(total) / 1e8]);
    await rpc('generatetoaddress', [1, address]);
    const utxo = (await vault.getUtxos()).find(u => u.txid === funding)!;
    assert.ok(utxo);
    const build = (winner: number, payoutDelta = 0n) => {
      const builder = new TransactionBuilder({ provider }).setLocktime(Number(boundary))
        .addInput(utxo, vault.unlock.settle(BigInt(winner)));
      builder.addOutput({ to: payees[winner]!, amount: rs[winner]! + payoutDelta });
      for (let i = 0; i < 3; i++) builder.addOutput({ to: i === winner ? locks[i]!.address : payees[i]!, amount: stakes[i]! });
      return builder.addOutput({ to: address, amount: reserve - rs[winner]! - payoutDelta });
    };
    return { vault, build };
  }
  async function rejected(raw: string, name: string, reason = /mandatory-script-verify-flag-failed.*OP_/) {
    const [result] = await rpc('testmempoolaccept', [[raw]]);
    assert.equal(result.allowed, false, name);
    assert.match(result['reject-reason'], reason, name);
    reports.push({ name, result });
  }
  const main = await setup(10000n);
  await rejected(main.build(2).build(), 'lower-ranked winner');
  await rejected(main.build(1).build(), 'later equal-ranked offer');
  await rejected(main.build(0, 1n).build(), 'incorrect payout');
  const poor = await setup(4000n);
  await rejected(poor.build(0).build(), 'insufficient full reserve');
  const future = await setup(10000n, rewards, start + 100000n);
  await rejected(future.build(0).build(), 'period not started', /bad-txns-nonfinal/);
  const unique = await setup(11000n, [2000n, 2000n, 2000n]);
  await rejected(unique.build(0).build(), 'strictly higher offer exists');
  const uniqueSent = await unique.build(1).send();
  const competing = main.build(0).setLocktime(Number(start + 1n)).build();
  const [candidate] = await rpc('testmempoolaccept', [[competing]]);
  assert.equal(candidate.allowed, true, 'competing settlement is independently valid');
  const raw = main.build(0).build();
  const sent = await main.build(0).send();
  await rejected(competing, 'conflicting settlement', /txn-mempool-conflict/);
  await rpc('generatetoaddress', [1, address]);
  await assert.rejects(() => provider.sendRawTransaction(raw));
  const tx = await rpc('getrawtransaction', [sent.txid, true]);
  assert.ok(tx.confirmations >= 1);
  assert.equal(Math.round(tx.vout[0].value * 1e8), 2000);
  assert.equal(tx.vout[0].scriptPubKey.addresses?.[0] ?? tx.vout[0].scriptPubKey.address, payees[0]);
  const locked = (await locks[0]!.getUtxos()).find(u => u.txid === sent.txid)!;
  assert.ok(locked);
  const early = new TransactionBuilder({ provider }).setLocktime(Number(start))
    .addInput(locked, locks[0]!.unlock.withdraw()).addOutput({ to: payees[0]!, amount: locked.satoshis - 1000n });
  await rejected(early.build(), 'early stake withdrawal', /Locktime requirement not satisfied/);
  reports.push({ accepted: sent.txid, uniqueWinner: uniqueSent.txid, confirmations: tx.confirmations, bytes: raw.length / 2,
    covenantBytes: main.vault.bytecode.length / 2 });
  await writeFile('docs/vault-test-result.json', JSON.stringify(reports, null, 2) + '\n');
});
