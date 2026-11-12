import assert from 'node:assert/strict';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {SignatureTemplate} from 'cashscript';
import {SettlementChain,settlementConfig} from './settlement-chain.js';
import {BrowserWallet,type WalletOperation,type WalletOperationStore} from '../../src/browser-wallet.js';
import {ElectrumIndexer} from '../../src/indexer-core.js';
import {decodeRawTransaction} from '../../src/electrum-core.js';
import {walletScript,type BrowserPlan,type WalletKey} from '../../src/transactions-core.js';
const key=(v:number)=>new SignatureTemplate(new Uint8Array(32).fill(v));
export class WalletFixture {
 chain=new SettlementChain();signers=[key(31),key(32),key(33)];
 keys:WalletKey[]=this.signers.map((k,i)=>({publicKey:binToHex(k.publicKey),path:i===2?'change':'receive',index:i===1?1:0}));
 asset='e1'.repeat(32);other='e2'.repeat(32);journal=new Map<string,WalletOperation>();
 store:WalletOperationStore={list:async()=>structuredClone([...this.journal.values()]),save:async o=>{this.journal.set(o.id,structuredClone(o));}};
 engine:BrowserWallet;
 constructor(){
  this.chain.permittedFees.add(2000n);
  const script=hexToBin(walletScript(this.keys[1].publicKey));
  const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:new Uint8Array(32),outpointIndex:0xffffffff,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array([1,1])}],outputs:[{lockingBytecode:script,valueSatoshis:250000n},{lockingBytecode:script,valueSatoshis:1000n,token:{category:hexToBin(this.asset),amount:1000n}},{lockingBytecode:script,valueSatoshis:1000n,token:{category:hexToBin(this.asset),amount:1500n}},{lockingBytecode:script,valueSatoshis:1000n,token:{category:hexToBin(this.other),amount:5000n}},{lockingBytecode:script,valueSatoshis:1000n,token:{category:hexToBin(this.asset),amount:500n,nft:{capability:'none',commitment:hexToBin('12')}}}]}));
  const tx=decodeRawTransaction(raw);this.chain.transactions.set(tx.txid,tx);this.chain.mine([tx.txid]);this.engine=this.restart();
 }
 restart(){return this.engine=new BrowserWallet(new ElectrumIndexer([settlementConfig],this.chain.provider()),this.store);}
 parameters(){return {stakingCategory:this.asset,epoch:this.chain.clock().mtp-60,periodSeconds:60,periods:2,cap:2000};}
 sign(plan:BrowserPlan,flag=0x61){const tx=structuredClone(plan.request.transaction) as Transaction,sources=plan.request.sourceOutputs;
  for(const [i,path,index] of plan.inputPaths){const descriptor=this.keys.find(k=>k.path===path&&k.index===index)!,signer=this.signers.find(k=>binToHex(k.publicKey)===descriptor.publicKey)!,source=sources[i],preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:sources,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(flag)}),signature=signer.generateSignature(hash256(preimage));signature[64]=flag;
   tx.inputs[i].unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(signature))):new Uint8Array([...encodeDataPush(signature),...encodeDataPush(signer.publicKey)]);
  }return binToHex(encodeTransaction(tx));
 }
 async created(){await this.engine.scan(this.keys);let op=await this.engine.create(this.parameters(),this.keys);op=await this.engine.submit(op.id,this.sign(op.plan!),this.keys);assert.equal(op.stage,'pending');this.chain.mine();op=await this.engine.advance(op.id,this.keys);assert.equal(op.step,'genesis');this.chain.mine();op=await this.engine.get(op.id);assert.equal(op.step,'complete');return op;}
}
