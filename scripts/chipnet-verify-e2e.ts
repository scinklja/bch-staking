import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {cashAddressToLockingBytecode,binToHex} from '@bitauth/libauth';
import {Indexer} from '../src/indexer.js';
import {verifyRegistryGenesis} from '../src/genesis.js';
import {rpc,assertNetwork,networkConfig} from '../src/rpc.js';
import {json,type VaultConfig,records} from '../src/arena.js';
if(networkConfig().network!=='chipnet')throw Error('Chipnet only');
const info=await assertNetwork(true);
const config:VaultConfig=JSON.parse(await readFile('.chipnet/e2e-config.json','utf8'));
const funding=JSON.parse(await readFile('.chipnet/wallet-funding.json','utf8'));
const provision=JSON.parse(await readFile('.chipnet/provision.json','utf8'));
const receipts=(await readFile('.chipnet/broadcasts.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
const unique=[...new Map(receipts.map(r=>[r.txid,r])).values()];
const transactions=[];
for(const receipt of unique){
 const tx=await rpc('getrawtransaction',[receipt.txid,true]);
 assert.ok(tx.confirmations>0,`${receipt.label} is not confirmed: ${receipt.txid}`);
 let inputs=0;
 for(const input of tx.vin){const parent=await rpc('getrawtransaction',[input.txid,true]);inputs+=Math.round(parent.vout[input.vout].value*1e8);}
 transactions.push({...receipt,confirmations:tx.confirmations,confirmationBlock:tx.blockhash,height:(await rpc('getblockheader',[tx.blockhash])).height,feeSatoshis:inputs-tx.vout.reduce((sum:number,o:any)=>sum+Math.round(o.value*1e8),0)});
}
const genesis=await verifyRegistryGenesis(config.genesis,config);
const index=new Indexer([config]);await index.sync();await index.verifyUtxos();
const vault=index.vaults[0]!;assert.ok(vault);
const state=Buffer.from(vault.witness,'hex'),offers=records(state);
assert.equal(state.readUInt32LE(0),1);assert.equal(state[4],0);assert.equal(offers.length,1);assert.equal(offers[0]!.wins,1);
assert.deepEqual(vault.history.map(h=>h.action),[0,2,3]);
assert.equal(vault.allocations.length,1);
const allocation=vault.allocations[0]!;assert.ok(allocation.withdrawal,'Independent allocation withdrawal is not confirmed');
const settlement=vault.transaction,withdrawal=await rpc('getrawtransaction',[allocation.withdrawal,true]);
const destination=cashAddressToLockingBytecode(funding.destination);assert.notEqual(typeof destination,'string');
const lockingBytecode=typeof destination==='string'?'':binToHex(destination.bytecode);
assert.equal(Math.round(settlement.vout[2].value*1e8),1000);assert.equal(settlement.vout[2].scriptPubKey.hex,lockingBytecode);
assert.equal(settlement.vout[3].tokenData.amount,'1000');assert.equal(settlement.vout[3].tokenData.category,config.stakingCategory);
assert.equal(withdrawal.vin.length,1);assert.equal(`${withdrawal.vin[0].txid}:${withdrawal.vin[0].vout}`,allocation.id);
assert.equal(withdrawal.vout.length,1);assert.equal(withdrawal.vout[0].tokenData.amount,'1000');assert.equal(withdrawal.vout[0].tokenData.category,config.stakingCategory);assert.equal(withdrawal.vout[0].scriptPubKey.hex,lockingBytecode);
assert.equal(await rpc('gettxout',[settlement.txid,3,false]),null);
const minted=await rpc('getrawtransaction',[provision.tokenGenesis,true]);
assert.equal(minted.vin[0].txid,config.stakingCategory);assert.equal(minted.vin[0].vout,0);assert.equal(minted.vout.length,1);assert.equal(minted.vout[0].tokenData.amount,'1000000000');assert.equal(minted.vout[0].tokenData.nft,undefined);
execFileSync('git',['diff','--exit-code','--','contracts','artifacts']);
const tags=execFileSync('git',['show-ref','--tags'],{encoding:'utf8'});
assert.ok(tags.includes('6c2c1bc8324e103b1b52c008ed77374b938cd808 refs/tags/staking-allocations-2026-11-09'));
assert.ok(tags.includes('3070fb9684a9c51920307bc2bd63b393de819dcd refs/tags/v0.2.0-regtest'));
const evidence={observedAt:new Date().toISOString(),network:'chipnet',result:'confirmed-end-to-end',tip:{height:info.blocks,hash:info.bestblockhash,mtp:info.mediantime},config,genesis,
 transactions,confirmedProjectTransactions:transactions.length,totalProjectFeesSatoshis:transactions.reduce((sum,t)=>sum+t.feeSatoshis,0),
 reward:{txid:settlement.txid,vout:2,satoshis:1000,owner:funding.destination},
 independentWithdrawal:{txid:withdrawal.txid,spent:allocation.id,inputCount:withdrawal.vin.length,registryInputs:0,returnedTokens:'1000',category:config.stakingCategory,owner:funding.destination},
 finiteTestSupply:'1000000000',finalVaultReserveSatoshis:Math.round(settlement.vout[0].value*1e8),covenantModifications:[],milestoneTagsPreserved:tags.trim().split('\n'),
 localSimulations:'See chipnet-local-verification.json; excluded from these transaction counts',walletEvidence:'chipnet-wallet-verification.json',mainnetRejection:'chipnet-mainnet-rejection.json'};
await writeFile('docs/chipnet-e2e-verification.json',json(evidence));process.stdout.write(json(evidence));
