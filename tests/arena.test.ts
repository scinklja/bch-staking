import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { SignatureTemplate, TransactionBuilder, type SpendableUtxo } from 'cashscript';
import { encodeCashAddress, hash160 } from '@bitauth/libauth';
import { rpc, assertRegtest } from '../src/rpc.js';
import { Indexer } from '../src/indexer.js';
import { Keeper } from '../src/keeper.js';
import { api, vaultView } from '../src/api.js';
import { type VaultConfig, contract, contracts, provider, utxo, json, rankings } from '../src/arena.js';
import { STATE_SIZE, SNAPSHOT, LIVE, RECORD_SIZE, hashState, offer, nextState, remainingCommitment } from '../src/registry.js';

const exec = promisify(execFile);
test('v0.3 automated keeper/indexer: catch-up, sponsorship, competitors, restarts, BCHN outage, reorg, replay, API and UTXOs', { timeout: 600000 }, async () => {
  await assertRegtest();
  const before = await rpc('getblockchaininfo'), baselineTag = (await exec('git', ['rev-parse', 'v0.2.0-regtest'])).stdout.trim();
  const directory = await mkdtemp(join(tmpdir(), 'staking-arena-'));
  const owner = new SignatureTemplate(new Uint8Array(32).fill(177));
  const sponsorKey = new SignatureTemplate(new Uint8Array(32).fill(178));
  const deposit = await contract('RegistryDeposit', [owner.publicKey]), feeDeposit = await contract('RegistryDeposit', [sponsorKey.publicKey]);
  const mining = await rpc<string>('getnewaddress');
  const mine = (n = 1) => rpc<string[]>('generatetoaddress', [n, mining]);
  const out = async (txid: string, n: number) => utxo(await rpc('getrawtransaction', [txid, true]), n);
  async function fund(amount: bigint, target = deposit) {
    const txid = await rpc<string>('sendtoaddress', [target.address, Number(amount) / 1e8]);
    const tx = await rpc('getrawtransaction', [txid, true]);
    return utxo(tx, tx.vout.findIndex((v: any) => v.scriptPubKey.hex === target.lockingBytecode));
  }
  const input = await fund(1000000n);
  const preAsset = await new TransactionBuilder({ provider }).addInput(input, deposit.unlock.spend(owner)).addOutput({ to: deposit.address, amount: 990000n }).send();
  const stakingCategory = preAsset.txid;
  const asset = await new TransactionBuilder({ provider }).addInput(await out(stakingCategory, 0), deposit.unlock.spend(owner))
    .addOutput({ to: deposit.tokenAddress, amount: 10000n, token: { category: stakingCategory, amount: 3000n } })
    .addOutput({ to: deposit.tokenAddress, amount: 10000n, token: { category: stakingCategory, amount: 6000n } }).send();
  const epoch = (await rpc('getblockchaininfo')).mediantime - 1000;
  const parameters = { stakingCategory, epoch, periodSeconds: 1, periods: 3, cap: 1000 };
  const factory = await contract('RegistryGenesis', [Buffer.from(stakingCategory,'hex').reverse(), BigInt(epoch), 1n, 3n, 1000n]);
  const funding = await fund(25000n);
  const pregen = await new TransactionBuilder({ provider }).addInput(funding, deposit.unlock.spend(owner)).addOutput({ to: factory.address, amount: 15000n }).send();
  const category = pregen.txid;
  const cs = await contracts({ ...parameters, genesis: '' }, category);
  let state: Buffer = Buffer.alloc(STATE_SIZE);
  const token = (s: Buffer) => ({ category, amount: 0n, nft: { capability: 'mutable' as const, commitment: hashState(s) } });
  const genesis = await new TransactionBuilder({ provider }).addInput(await out(category,0), factory.unlock.create())
    .addOutput({ to: cs.registry.tokenAddress, amount: 4000n, token: token(state) }).addOutput({ to: cs.pool.address, amount: 1000n }).send();
  const config: VaultConfig = { ...parameters, genesis: genesis.txid };
  let current = genesis.txid;
  for (let slot = 0; slot < 2; slot++) {
    const record = offer(owner.publicKey, slot ? 2000 : 1000, 1, 1000, 3), next = nextState(state, 0, slot, record);
    const registration = await new TransactionBuilder({ provider }).addInput(await out(current,0), cs.registry.unlock.transition(state, 0n, BigInt(slot), record, owner))
      .addInput(await out(current,1), cs.pool.unlock.spend()).addInput(await out(asset.txid,slot), deposit.unlock.spend(owner))
      .addOutput({ to: cs.registry.tokenAddress, amount: 4000n, token: token(next) })
      .addOutput({ to: cs.pool.tokenAddress, amount: 1000n, token: { category: stakingCategory, amount: remainingCommitment(next) } }).send();
    current = registration.txid; state = next;
  }
  const fees: SpendableUtxo[] = [];
  for (let i = 0; i < 8; i++) fees.push(await fund(15000n, feeDeposit));
  await mine();
  const initialTip = await rpc('getblockchaininfo');
  const path = join(directory, 'index.json'), index = new Indexer([config], path);
  await index.sync(); await index.verifyUtxos();
  console.log('registration replay and UTXOs verified');
  assert.equal(index.vaults[0]!.witness, state.toString('hex'));
  assert.equal(index.vaults[0]!.history.filter(e => e.action === 0).length, 2);
  assert.equal(rankings(state)[0]!.slot, 1);
  const keeper = new Keeper(index);
  await assert.rejects(() => keeper.build(index.vaults[0]!), /sponsorship required/);
  const sponsorship = async () => {
    for (const input of fees) if (await rpc('gettxout', [input.txid, input.vout, true])) return { input, unlocker: feeDeposit.unlock.spend(sponsorKey) };
  };
  const sponsored = new Keeper(index, sponsorship);
  const second = new Indexer([config], join(directory, 'competitor.json'));
  const competitor = new Keeper(second, async () => {
    // Distinct sponsor outpoints produce genuinely competing transaction IDs.
    for (const input of [...fees].reverse()) if (await rpc('gettxout', [input.txid, input.vout, true])) return { input, unlocker: feeDeposit.unlock.spend(sponsorKey) };
  });
  const competed = await Promise.all([sponsored.tick(), competitor.tick()]);
  assert.ok(competed.flat().some(r => r.status === 'broadcast'));
  await mine(); await index.sync();
  assert.equal(Buffer.from(index.vaults[0]!.witness,'hex')[4],1);
  // The complete state preimage prevents omitting a higher-ranked offer or changing committed terms.
  for (const offset of [SNAPSHOT + RECORD_SIZE + 47, SNAPSHOT + RECORD_SIZE + 37]) {
    const fake = Buffer.from(index.vaults[0]!.witness, 'hex'); fake[offset] = fake[offset]! ^ 1;
    const candidate = await sponsored.build({ ...index.vaults[0]!, witness: fake.toString('hex') });
    assert.ok(candidate);
    const [result] = await rpc('testmempoolaccept', [[candidate.raw]]);
    assert.equal(result.allowed, false); assert.match(result['reject-reason'], /mandatory-script/);
  }
  // Sequential automated catch-up: no test code constructs or selects a settlement.
  let firstSettlementBlock = '';
  for (let tick = 0; tick < 8; tick++) {
    const results = await Promise.all([sponsored.tick(), competitor.tick()]);
    if (results.flat().some(r => r.status === 'broadcast')) {
      const blocks = await mine(); if (!firstSettlementBlock) firstSettlementBlock = blocks[0]!;
    }
    await index.sync();
    if (Buffer.from(index.vaults[0]!.witness,'hex').readUInt32LE(0) === 3) break;
  }
  assert.equal(Buffer.from(index.vaults[0]!.witness,'hex').readUInt32LE(0),3);
  assert.equal(index.vaults[0]!.allocations.length,3);
  console.log('three sponsored periods settled automatically');
  assert.ok(index.vaults[0]!.history.filter(e => e.action === 3).every(e => e.slot === 1));
  assert.equal(index.vaults[0]!.transaction.vout[0].value,0.00001);
  assert.equal(remainingCommitment(Buffer.from(index.vaults[0]!.witness,'hex')),3000n);
  await index.verifyUtxos();
  const completeWitness = index.vaults[0]!.witness;
  await index.sync(); assert.equal(index.vaults[0]!.allocations.length,3, 'duplicate block polling is idempotent');
  const restarted = new Indexer([config],path); await restarted.load(); await restarted.sync();
  assert.equal(restarted.vaults[0]!.witness, completeWitness);
  // Real transport outage and node restart, retaining wallet and chain directories.
  try {
    await exec('bash', ['scripts/node.sh','stop']);
    await assert.rejects(() => restarted.sync());
    assert.equal(restarted.health.connected,false);
    assert.equal(restarted.vaults[0]!.witness,completeWitness);
  } finally { await exec('bash', ['scripts/node.sh','start']); }
  console.log('BCHN disconnected and restarted');
  await restarted.sync(); assert.equal(restarted.health.connected,true); await restarted.verifyUtxos();
  // Withdraw a matured independent allocation; index and reconcile it.
  const a = index.vaults[0]!.allocations[0]!, terms = Buffer.from(a.terms,'hex'), allocation = await contract('StakeAllocation',[terms]);
  const payee = encodeCashAddress({ prefix: 'bchreg', type:'p2pkhWithTokens', payload:hash160(owner.publicKey) });
  assert.notEqual(typeof payee,'string'); if (typeof payee === 'string') throw Error(payee);
  const withdrawal = await new TransactionBuilder({ provider }).setLocktime(terms.readUInt32LE(74))
    .addInput(await out(a.id.split(':')[0]!,3), allocation.unlock.withdraw(owner))
    .addOutput({ to: payee.address, amount:1000n, token:{category:stakingCategory,amount:2000n} }).send();
  await mine(); await index.sync(); await index.verifyUtxos();
  assert.equal(index.vaults[0]!.allocations[0]!.withdrawal,withdrawal.txid);
  // Owner-authorized future cancellation and refund are reconstructed alongside keeper events.
  for (const action of [1,4]) {
    const v=index.vaults[0]!, witness=Buffer.from(v.witness,'hex'), next=nextState(witness,action,0);
    const fee=await sponsorship(); assert.ok(fee);
    const builder=new TransactionBuilder({provider}).setLocktime((await rpc('getblockchaininfo')).mediantime-1)
      .addInput(utxo(v.transaction,0),cs.registry.unlock.transition(witness,BigInt(action),0n,Buffer.alloc(0),owner))
      .addInput(utxo(v.transaction,1),cs.pool.unlock.spend()).addInput(fee.input,fee.unlocker)
      .addOutput({to:cs.registry.tokenAddress,amount:utxo(v.transaction,0).satoshis,token:token(next)})
      .addOutput({to:cs.pool.tokenAddress,amount:1000n,...(remainingCommitment(next) ? {token:{category:stakingCategory,amount:remainingCommitment(next)}} : {})});
    if(action===4) builder.addOutput({to:payee.address,amount:1000n,token:{category:stakingCategory,amount:3000n}});
    await builder.send();await mine();await index.sync();await index.verifyUtxos();
  }
  assert.equal(Buffer.from(index.vaults[0]!.witness,'hex')[LIVE+48],1);
  assert.equal(remainingCommitment(Buffer.from(index.vaults[0]!.witness,'hex')),0n);
  const preReorg = index.tip!.hash;
  try {
    await rpc('invalidateblock',[firstSettlementBlock]);
    await index.sync();
    assert.equal(index.vaults[0]!.allocations.length,0);
    assert.equal(Buffer.from(index.vaults[0]!.witness,'hex')[4],1);
    await index.verifyUtxos();
    // Mine a replacement branch from disconnected valid mempool transactions.
    await mine(2); await index.sync(); await index.verifyUtxos();
    const fresh = new Indexer([config]); await fresh.sync();
    assert.equal(fresh.vaults[0]!.witness,index.vaults[0]!.witness);
    assert.deepEqual(fresh.vaults[0]!.allocations,index.vaults[0]!.allocations);
  } finally { await rpc('reconsiderblock',[firstSettlementBlock]); }
  await index.sync(); await index.verifyUtxos();
  console.log('withdrawal, rollback and fresh reconstruction verified');
  // Actual keeper process crash/restart from a durable checkpoint, no stale ownership lock.
  const serviceConfig = join(directory,'service.json');
  await writeFile(serviceConfig,json({vaults:[config],checkpoint:path,port:0,pollMs:100,keeper:true}));
  async function runService(signal: NodeJS.Signals) {
    const child = spawn(process.execPath,['--import','tsx','scripts/arena.ts',serviceConfig], {cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
    let log = ''; child.stderr.on('data', b => {log += b;});
    const exited = once(child,'exit');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        once(child.stdout,'data'),
        exited.then(()=>{throw Error(`Service exited before readiness: ${log}`);}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Service did not start: ${log}`)),30000);timer.unref();}),
      ]);
      assert.equal(log,'');
    } finally {
      clearTimeout(timer);
      if(child.exitCode===null && child.signalCode===null) child.kill(signal);
      await exited;
    }
  }
  await runService('SIGKILL'); await runService('SIGTERM');
  const server = api(index); server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const suffix of ['', '/offers','/rankings','/periods','/allocations','/withdrawals','/history']) {
      const response = await fetch(`${base}/vaults/${category}${suffix}`); assert.equal(response.status,200);
      assert.equal((await response.json()).tip.hash,index.tip!.hash);
    }
    assert.equal((await fetch(`${base}/vaults`,{method:'POST'})).status,405);
    assert.equal((await fetch(`${base}/vaults/missing`)).status,404);
    assert.equal((await fetch(`${base}/health`)).status,200);
    assert.equal(vaultView(index,category)!.withdrawals.allocations[0]!.eligible,false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal(await rpc('getblockhash',[before.blocks]),before.bestblockhash);
  assert.equal((await exec('git',['rev-parse','v0.2.0-regtest'])).stdout.trim(),baselineTag);
  const evidence = { verifiedAt:new Date().toISOString(), before, initialTip, after:await rpc('getblockchaininfo'), category, genesis:config.genesis,
    directory, config, checkpoint:path, preReorg, competingResults:competed, settlements:index.vaults[0]!.history.filter(e=>e.action===3), allocations:index.vaults[0]!.allocations,
    verified:['sponsored automatic three-period catch-up','canonical winner','forged witnesses rejected by BCHN','competing keepers','idempotent sync','checkpoint restart','BCHN stop/start','independent withdrawal','owner cancellation and commitment refund','multi-block rollback and replacement branch','fresh reconstruction','SIGKILL and SIGTERM restart','GET-only API','on-chain UTXO reconciliation','existing chain and milestone tag preserved'] };
  await writeFile('docs/keeper-indexer-test-result.json',json(evidence));
});
