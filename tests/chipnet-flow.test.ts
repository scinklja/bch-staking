import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex,hexToBin,decodeTransaction,encodeTransaction,hashTransactionUiOrder,createVirtualMachineBch2026,generateSigningSerializationBch,hash256,encodeDataPush,cashAddressToLockingBytecode } from '@bitauth/libauth';
import { SignatureTemplate } from 'cashscript';
import { createVaultPlan,createVaultGenesis,prepareOfferFunding,makeOfferPlan,withdrawAllocationPlan,submitWalletPlan,walletAddress,type WalletPlan } from '../src/transactions.js';
import { networkConfig } from '../src/rpc.js';
import { utxo } from '../src/arena.js';
import { nextState,offer,allocationTerms } from '../src/registry.js';
import { Keeper } from '../src/keeper.js';
import { Indexer,type VaultState } from '../src/indexer.js';

test('LOCAL VM ONLY: wallet-signature placeholders, genesis, offer, activation, reward and independent withdrawal',async()=>{
  const original={...process.env},fetcher=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'arena-flow-'));
  await writeFile(join(dir,'cookie'),'local:simulation');
  process.env.ARENA_NETWORK='chipnet';process.env.BCH_RPC_COOKIE=join(dir,'cookie');
  const key=new SignatureTemplate(new Uint8Array(32).fill(77)),vm=createVirtualMachineBch2026();
  const ledger=new Map<string,any>();
  const address=walletAddress(key.publicKey),decoded=cashAddressToLockingBytecode(address);
  assert.notEqual(typeof decoded,'string');
  const lock=typeof decoded==='string'?'':binToHex(decoded.bytecode);
  const asset='bb'.repeat(32),seed='aa'.repeat(32),tokenSeed='cc'.repeat(32);
  ledger.set(seed,{txid:seed,confirmations:1,vin:[],vout:[{n:0,value:0.01,scriptPubKey:{hex:lock}}]});
  ledger.set(tokenSeed,{txid:tokenSeed,confirmations:1,vin:[],vout:[{n:0,value:0.001,scriptPubKey:{hex:lock},tokenData:{category:asset,amount:'1000000'}}]});
  const now=Math.floor(Date.now()/1000);
  function record(raw:string) {
    const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string') throw Error(tx);
    const txid=binToHex(hashTransactionUiOrder(hexToBin(raw)));
    const data={txid,confirmations:1,blockhash:'dd'.repeat(32),vin:tx.inputs.map(i=>({txid:binToHex(i.outpointTransactionHash),vout:i.outpointIndex})),vout:tx.outputs.map((o,n)=>({n,value:Number(o.valueSatoshis)/1e8,scriptPubKey:{hex:binToHex(o.lockingBytecode)},...(o.token?{tokenData:{category:binToHex(o.token.category),amount:o.token.amount.toString(),...(o.token.nft?{nft:{...o.token.nft,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})}))};
    ledger.set(txid,data);return data;
  }
  function verify(raw:string) {
    const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string') throw Error(tx);
    const sources=tx.inputs.map(i=>{
      const o=ledger.get(binToHex(i.outpointTransactionHash)).vout[i.outpointIndex];
      return {valueSatoshis:BigInt(Math.round(o.value*1e8)),lockingBytecode:hexToBin(o.scriptPubKey.hex),...(o.tokenData?{token:{category:hexToBin(o.tokenData.category),amount:BigInt(o.tokenData!.amount),...(o.tokenData.nft?{nft:{...o.tokenData.nft,commitment:hexToBin(o.tokenData.nft.commitment)}}:{})}}:{})};
    });
    assert.equal(vm.verify({transaction:tx,sourceOutputs:sources}),true);
    return record(raw);
  }
  function sign(plan:WalletPlan) {
    const tx=structuredClone(plan.request.transaction),sources=plan.request.sourceOutputs;
    for(const [i] of plan.inputPaths){
      const source=sources[i]!;
      const coveredBytecode=source.contract?.redeemScript??source.lockingBytecode;
      const preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:sources,inputIndex:i},{coveredBytecode,signingSerializationType:new Uint8Array([0x61])});
      const signature=key.generateSignature(hash256(preimage));
      tx.inputs[i]!.unlockingBytecode=source.contract
        ? hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(signature)))
        : new Uint8Array([...encodeDataPush(signature),...encodeDataPush(key.publicKey)]);
    }
    return binToHex(encodeTransaction(tx));
  }
  globalThis.fetch=async(_url,init)=>{
    const {method,params}=JSON.parse(init!.body as string);
    let result:any;
    if(method==='getblockchaininfo') result={chain:'chip',blocks:331817,headers:331817,initialblockdownload:false,mediantime:now};
    else if(method==='getblockhash') result=params[0]===0?networkConfig().genesis:'0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78';
    else if(method==='getnetworkinfo') result={networkactive:true};
    else if(method==='getconnectioncount') result=1;
    else if(method==='getrawtransaction') result=ledger.get(params[0]);
    else if(method==='testmempoolaccept') {verify(params[0][0]);result=[{allowed:true}];}
    else if(method==='sendrawtransaction') result=binToHex(hashTransactionUiOrder(hexToBin(params[0])));
    else throw Error('Unexpected simulated RPC '+method);
    return new Response(JSON.stringify({result,error:null}));
  };
  try {
    const parameters={stakingCategory:asset,epoch:now-100,periodSeconds:1,periods:1,cap:2000};
    const creation=await createVaultPlan(parameters,utxo(ledger.get(seed),0),key.publicKey,150000n);
    const parent=verify(sign(creation));
    const genesis=await createVaultGenesis(parameters,parent.txid);
    const tx=verify(genesis.raw);
    const config={...parameters,genesis:tx.txid};
    const vault:VaultState={config,category:parent.txid,witness:Buffer.alloc(1574).toString('hex'),transaction:tx,history:[],allocations:[]};
    const prep=await prepareOfferFunding(utxo(ledger.get(tokenSeed),0),key.publicKey,1000n);
    const tokenFunding=verify(sign(prep));
    const terms={stake:1000,duration:1,reward:1000,maxWins:1};
    const registration=await makeOfferPlan(vault,utxo(tokenFunding,0),key.publicKey,terms);
    assert.deepEqual(registration.inputPaths,[[0,'receive',0],[2,'receive',0]]);
    const registered=verify(sign(registration));
    vault.witness=nextState(Buffer.from(vault.witness,'hex'),0,0,offer(key.publicKey,1000,1,1000,1)).toString('hex');vault.transaction=registered;
    const keeper=new Keeper(new Indexer([]));
    const activation=await keeper.build(vault);assert.equal(activation?.action,2);
    vault.transaction=verify(activation!.raw);vault.witness=nextState(Buffer.from(vault.witness,'hex'),2,0).toString('hex');
    const settlement=await keeper.build(vault);assert.equal(settlement?.action,3);
    const settled=verify(settlement!.raw);
    assert.equal(settled.vout[2].value,0.00001,'reward is paid atomically');
    assert.equal(settled.vout[3].tokenData!.amount,'1000');
    const allocation={id:`${settled.txid}:3`,terms:allocationTerms(key.publicKey,vault.category,asset,0,0,1000,now-99).toString('hex'),output:settled.vout[3]};
    const withdrawal=await withdrawAllocationPlan(allocation,key.publicKey);
    const withdrawn=verify(sign(withdrawal));
    assert.equal(withdrawn.vout[0].tokenData!.amount,'1000');
    const altered=structuredClone(withdrawal.request.transaction);altered.outputs[0]!.valueSatoshis=999n;
    await assert.rejects(()=>submitWalletPlan(withdrawal,binToHex(encodeTransaction(altered))),/altered/);
    // Evidence is explicitly a local VM run using synthetic outpoints; no public node is called.
  } finally {globalThis.fetch=fetcher;process.env=original;await rm(dir,{recursive:true});}
});
