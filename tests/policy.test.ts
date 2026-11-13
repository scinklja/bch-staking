import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { binToHex, encodeTransaction } from '@bitauth/libauth';
import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { TokenRegtestProvider } from '../src/token-provider.js';
import { relayPeer } from '../src/relay-peer.js';

test('BCHN standard policy control: oversized data rejected on both nodes; smaller control relays and confirms', { timeout: 900000 }, async () => isolatedRegtest(async () => {
  await assertRegtest();
  assert.equal((await rpc('getnetworkinfo')).networkactive, false);
  const checkpoint = await rpc('getblockchaininfo');
  const relay = await relayPeer();
  try {
    const provider = new TokenRegtestProvider();
    const owner = new SignatureTemplate(new Uint8Array(32).fill(200));
    const deposit = new Contract(JSON.parse(await readFile('artifacts/RegistryDeposit.json', 'utf8')), [owner.publicKey], { provider, contractType: 'p2sh32' });
    const fundingId = await rpc<string>('sendtoaddress', [deposit.address, 0.0001]);
    await relay.until(async () => (await relay.peer<string[]>('getrawmempool')).includes(fundingId), 'control funding relay');
    const funding = await rpc('getrawtransaction', [fundingId, true]);
    const output = funding.vout.find((v: any) => v.scriptPubKey.hex === deposit.lockingBytecode);
    const input = { txid: fundingId, vout: output.n, satoshis: 10000n, lockingBytecode: deposit.lockingBytecode };
    function raw(bytes: number) {
      const b = new TransactionBuilder({ provider }).addInput(input, deposit.unlock.spend(owner))
        .addOutput({ to: deposit.address, amount: 9000n });
      // Deliberately bypass SDK's data-size guard to test BCHN's actual policy.
      b.outputs.push({ to: Uint8Array.from([0x6a, 0x4c, bytes, ...Buffer.alloc(bytes)]), amount: 0n });
      return binToHex(encodeTransaction((b as any).buildLibauthTransaction(true)));
    }
    const large = raw(224), small = raw(200);
    const [localReject] = await rpc('testmempoolaccept', [[large]]);
    const [peerReject] = await relay.peer('testmempoolaccept', [[large]]);
    for (const rejected of [localReject, peerReject]) {
      assert.equal(rejected.allowed, false);
      assert.match(rejected['reject-reason'], /oversize-op-return/);
    }
    const [localAccept] = await rpc('testmempoolaccept', [[small]]);
    const [peerAccept] = await relay.peer('testmempoolaccept', [[small]]);
    assert.equal(localAccept.allowed, true); assert.equal(peerAccept.allowed, true);
    const txid = await provider.sendRawTransaction(small);
    await relay.until(async () => (await relay.peer<string[]>('getrawmempool')).includes(txid), 'standard control relay');
    await rpc('generatetoaddress', [1, await rpc('getnewaddress')]);
    await relay.until(async () => (await relay.peer('getrawtransaction', [txid, true])).confirmations > 0, 'standard control confirmation');
    assert.equal(await rpc('getblockhash', [checkpoint.blocks]), checkpoint.bestblockhash);
    await writeFile('docs/policy-test-result.json', JSON.stringify({ verifiedAt: new Date().toISOString(), node: (await rpc('getnetworkinfo')).subversion,
      peerDatadir: relay.directory, before: checkpoint, after: await rpc('getblockchaininfo'), localReject, peerReject, localAccept, peerAccept,
      rejectedBytes: large.length / 2, acceptedBytes: small.length / 2, relayedAndConfirmed: txid,
      note: 'Oversized data is a policy rejection; no invalid-block consensus experiment was performed.' }, null, 2) + '\n');
  } finally { await relay.close(); }
}));
