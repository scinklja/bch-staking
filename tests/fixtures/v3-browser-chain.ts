/** Synthetic linked headers/Merkle proofs with real compiled v3 VM validation.
 * This fixture is loopback-only; BCHN consensus integration is tested separately. */
import {MockNetworkProvider,Network,SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction} from '@bitauth/libauth';
import {SettlementChain} from './settlement-chain.js';
import {decodeRawTransaction} from '../../src/electrum-core.js';
import {utxo} from '../../src/arena-core.js';
import {walletScript} from '../../src/transactions-core.js';
import {covenant,parameterArgs,genesisBuilder,transitionBuilder,family,type Parameters,type Instance} from '../../src/v3/protocol.js';
const regtestGenesis='01000000'+'00'.repeat(32)+'3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a'+'dae5494d'+'ffff7f20'+'02000000';
export function v3BrowserChain(){
 const chain=new SettlementChain(),request=chain.request;
 chain.request=async(method,...params)=>method==='blockchain.block.header'&&params[0]===0?regtestGenesis:request(method,...params);
 const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
 const key=new SignatureTemplate(new Uint8Array(32).fill(86)),script=walletScript(binToHex(key.publicKey));let counter=1000;
 function add(raw:string,mine=true){const tx=decodeRawTransaction(raw);chain.transactions.set(tx.txid,tx);chain.pending.add(tx.txid);if(mine)chain.mine();return tx;}
 function coin(amount:bigint,locking=script,mine=true){return utxo(add(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:amount,lockingBytecode:hexToBin(locking)}]})),mine),0);}
 const parameters:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:chain.clock().mtp-10000,periodSeconds:100,periods:4,cap:2000n};
 const factory=covenant('RegistryGenesisV3',parameterArgs(parameters),provider),funding=coin(12000n,factory.lockingBytecode),reserve=coin(9000n);
 const g=genesisBuilder(parameters,funding,{input:reserve,unlocker:key.unlockP2PKH()},provider),genesis=add(g.builder.build());
 const v:Instance={parameters,category:funding.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};
 const stake=coin(6000n),fee=coin(10000n),offer=transitionBuilder(v,0,0,provider,chain.clock(),{input:fee,unlocker:key.unlockP2PKH()},key,{owner:key.publicKey,terms:{stake:3000n,duration:513,reward:2000n,maxWins:2},funding:{input:stake,unlocker:key.unlockP2PKH()}});
 add(offer.builder.build());
 const cs=family(parameters,funding.txid,provider),sponsor=covenant('FeeSponsorV3',[hexToBin(cs.registry.lockingBytecode)],provider);
 const donation=coin(10000n,sponsor.lockingBytecode,false);
 return {chain,config:{...parameters,genesis:genesis.txid},donation};
}
