import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Contract, TransactionBuilder } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { RegtestProvider } from '../src/provider.js';

test('local BCHN: isolated regtest, funding, rejected invalid spend, valid spend and confirmation', async () => {
  await assertRegtest();
  assert.equal(await rpc('getconnectioncount'), 0);
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  assert.ok(await rpc<number>('getblockcount') >= 101);
  assert.ok(await rpc<number>('getbalance') > 0);
  const provider = new RegtestProvider();
  const artifact = JSON.parse(await readFile('artifacts/Example.json', 'utf8'));
  const contract = new Contract(artifact, [42n], { provider, contractType: 'p2sh32' });
  const fundingTxid = await rpc<string>('sendtoaddress', [contract.address, 0.001]);
  const unconfirmed = await contract.getUtxos();
  assert.ok(unconfirmed.some(u => u.txid === fundingTxid));
  const destination = await rpc<string>('getnewaddress');
  await rpc('generatetoaddress', [1, destination]);
  const utxo = (await contract.getUtxos()).find(u => u.txid === fundingTxid)!;
  assert.ok(utxo);
  const build = (guess: bigint) => new TransactionBuilder({ provider })
    .addInput(utxo, contract.unlock.spend(guess))
    .addOutput({ to: destination, amount: utxo.satoshis - 1000n });
  const invalid = build(41n).build();
  await assert.rejects(() => provider.sendRawTransaction(invalid));
  const sent = await build(42n).send();
  assert.ok(!(await contract.getUtxos()).some(u => u.txid === fundingTxid));
  await rpc('generatetoaddress', [1, destination]);
  const confirmed = await rpc('getrawtransaction', [sent.txid, true]);
  assert.ok(confirmed.confirmations >= 1);
  const report = { fundingTxid, spendingTxid: sent.txid, confirmations: confirmed.confirmations, height: await provider.getBlockHeight(), balanceBCH: await rpc('getbalance') };
  await writeFile('docs/latest-test-result.json', JSON.stringify(report, null, 2) + '\n');
  console.log(report);
});
