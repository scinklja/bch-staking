import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { rpc, assertRegtest } from '../src/rpc.js';
import { contract, contracts, provider, utxo, json } from '../src/arena.js';
import { STATE_SIZE, hashState } from '../src/registry.js';
import { Indexer } from '../src/indexer.js';

const pause = () => new Promise(r => setTimeout(r, 50));
test('keeper daemon catches up empty periods after SIGKILL and rejects a shared checkpoint writer', {timeout:240000}, async () => {
  await assertRegtest();
  const before = await rpc('getblockchaininfo'), directory = await mkdtemp(join(tmpdir(),'arena-daemon-'));
  const key = new SignatureTemplate(new Uint8Array(32).fill(179)), deposit = await contract('RegistryDeposit',[key.publicKey]);
  const fund = await rpc<string>('sendtoaddress',[deposit.address,0.002]);
  const tx = await rpc('getrawtransaction',[fund,true]);
  const input = utxo(tx,tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===deposit.lockingBytecode));
  // An empty vault needs no minted staking assets: category is a pinned, distinct 32-byte ID.
  const stakingCategory = 'aa'.repeat(32), epoch = before.mediantime-1000;
  const params = {stakingCategory,epoch,periodSeconds:1,periods:3,cap:1000};
  const factory = await contract('RegistryGenesis',[Buffer.from(stakingCategory,'hex').reverse(),BigInt(epoch),1n,3n,1000n]);
  const pregen = await new TransactionBuilder({provider}).addInput(input,deposit.unlock.spend(key)).addOutput({to:factory.address,amount:111000n}).send();
  const cs = await contracts({...params,genesis:''},pregen.txid);
  const genesis = await new TransactionBuilder({provider}).addInput(utxo(await rpc('getrawtransaction',[pregen.txid,true]),0),factory.unlock.create())
    .addOutput({to:cs.registry.tokenAddress,amount:100000n,token:{category:pregen.txid,amount:0n,nft:{capability:'mutable',commitment:hashState(Buffer.alloc(STATE_SIZE))}}})
    .addOutput({to:cs.pool.address,amount:1000n}).send();
  const mining = await rpc<string>('getnewaddress');
  const mine = () => rpc('generatetoaddress',[1,mining]); await mine();
  const config = {...params,genesis:genesis.txid}, checkpoint = join(directory,'index.json'), configPath=join(directory,'config.json');
  await writeFile(configPath,json({vaults:[config],checkpoint,port:0,pollMs:100,keeper:true}));
  const observer = new Indexer([config]);
  let child: ChildProcess | undefined, output='', errors='';
  function start() {
    output=''; errors='';
    child=spawn(process.execPath,['--import','tsx','scripts/arena.ts',configPath],{stdio:['ignore','pipe','pipe']});
    child.stdout!.on('data',b=>{output+=b;}); child.stderr!.on('data',b=>{errors+=b;});
  }
  async function stop(signal: NodeJS.Signals) {
    if (child && child.exitCode===null && child.signalCode===null) {
      const exited=once(child,'exit');child.kill(signal);const [code,endedBy]=await exited;
      if(signal==='SIGKILL') assert.equal(endedBy,'SIGKILL'); else assert.equal(code,0);
    }
    child=undefined;
  }
  const broadcasts = () => [...output.matchAll(/"status": "broadcast"/g)].length;
  async function waitBroadcast(count: number) {
    const deadline=Date.now()+30000;
    while(broadcasts()<count) {if(Date.now()>deadline || child?.exitCode!==null) throw Error(`Keeper stalled: ${output} ${errors}`); await pause();}
  }
  try {
    start(); await waitBroadcast(1);
    // A second writer must fail before touching the checkpoint or API.
    const duplicate=spawn(process.execPath,['--import','tsx','scripts/arena.ts',configPath],{stdio:['ignore','ignore','pipe']});
    let duplicateError='';duplicate.stderr.on('data',b=>{duplicateError+=b;});
    const [code]=await once(duplicate,'exit'); assert.notEqual(code,0);assert.match(duplicateError,/EADDRINUSE/);
    await mine(); await observer.sync();
    assert.equal(Buffer.from(observer.vaults[0]!.witness,'hex')[4],1);
    await stop('SIGKILL');
    start();
    // Mine independently of new broadcasts: a valid pending spend may survive SIGKILL.
    // The daemon alone constructs every transition; the harness only provides confirmations.
    const deadline=Date.now()+120000;
    while(Buffer.from(observer.vaults[0]!.witness,'hex').readUInt32LE(0)<3) {
      if(Date.now()>deadline) throw Error(`Restart catch-up stalled: ${output} ${errors}`);
      await new Promise(resolve=>setTimeout(resolve,250));await mine();await observer.sync();
    }
    assert.equal(Buffer.from(observer.vaults[0]!.witness,'hex').readUInt32LE(0),3);
    assert.equal(observer.vaults[0]!.history.filter(h=>h.action===5).length,3);
    assert.equal(observer.vaults[0]!.allocations.length,0);
    assert.equal(Math.round(observer.vaults[0]!.transaction.vout[0].value*1e8),40000);
    await observer.verifyUtxos(); await stop('SIGTERM');
    const restarted=new Indexer([config],checkpoint);await restarted.load();await restarted.sync();
    assert.equal(restarted.vaults[0]!.witness,observer.vaults[0]!.witness);
    assert.equal(await rpc('getblockhash',[before.blocks]),before.bestblockhash);
    await writeFile('docs/keeper-daemon-test-result.json',json({verifiedAt:new Date().toISOString(),before,after:await rpc('getblockchaininfo'),genesis:genesis.txid,directory,daemonDiagnostics:errors,
      events:observer.vaults[0]!.history, verified:['actual daemon automatic empty-period catch-up','SIGKILL during incomplete schedule','durable restart and resumed settlement','exclusive checkpoint ownership','unsponsored fee accounting','SIGTERM shutdown','on-chain UTXOs','preexisting chain preserved']}));
  } finally {await stop('SIGTERM');}
});
