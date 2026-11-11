import {readFile} from 'node:fs/promises';
import {Indexer,type VaultState} from '../src/indexer.js';
import {Keeper} from '../src/keeper.js';
import {records,json,transitionWitness,type VaultConfig} from '../src/arena.js';
import {nextState,hashState,remainingCommitment} from '../src/registry.js';
import {recordChipnetBroadcast} from '../src/chain-evidence.js';
import {networkConfig,rpc,assertNetwork} from '../src/rpc.js';
if(networkConfig().network!=='chipnet')throw Error('Chipnet only');
const config:VaultConfig=JSON.parse(await readFile('.chipnet/e2e-config.json','utf8'));
const pendingOffer=process.argv.find(a=>a.startsWith('--pending-offer='))?.split('=')[1];
if(pendingOffer&&!/^[0-9a-f]{64}$/i.test(pendingOffer))throw Error('Invalid pending offer txid');
const index=new Indexer([config]),keeper=new Keeper(index);
async function relay(raw:string,action:number){
 await assertNetwork(true);
 const [accept]=await rpc('testmempoolaccept',[[raw]]);
 if(!accept.allowed)throw Error(`Package action ${action} rejected: ${accept['reject-reason']}`);
 const txid=await rpc<string>('sendrawtransaction',[raw]);
 await recordChipnetBroadcast(`keeper-action-${action}`,txid);
 process.stdout.write(json({status:'broadcast',action,txid,confirmed:false}));
 return txid;
}
for(;;){
 try{
  await index.sync();
  const confirmed=index.vaults[0];if(!confirmed)throw Error('No confirmed test vault');
  let proposal:VaultState=confirmed;
  const state=Buffer.from(confirmed.witness,'hex');
  process.stdout.write(json({observedAt:new Date().toISOString(),height:index.tip?.height,period:state.readUInt32LE(0),phase:state[4],offers:records(state).length,allocations:confirmed.allocations.length}));
  if(state.readUInt32LE(0)>=config.periods){await index.verifyUtxos();break;}
  // A private test proposal may use an explicitly pinned BCHN-accepted pending offer.
  // It never enters the confirmed indexer, checkpoint or public API projection.
  if(!records(state).length&&pendingOffer){
    const tx=await rpc('getrawtransaction',[pendingOffer,true]);
    if(!(tx.confirmations>0))await rpc('getmempoolentry',[pendingOffer]);
    const witness=transitionWitness(tx.vin[0].scriptSig.hex);
    if(witness.action!==0||witness.state.toString('hex')!==confirmed.witness||tx.vin[0].txid!==confirmed.transaction.txid||tx.vin[0].vout!==0||tx.vin[1].txid!==confirmed.transaction.txid||tx.vin[1].vout!==1)throw Error('Pending offer is not a direct canonical registration');
    const next=nextState(witness.state,0,witness.slot,witness.record);
    if(tx.vout[0].tokenData?.category!==confirmed.category||tx.vout[0].tokenData.nft?.commitment!==hashState(next)||BigInt(tx.vout[1].tokenData?.amount??0)!==remainingCommitment(next))throw Error('Pending offer state mismatch');
    proposal={...confirmed,transaction:tx,witness:next.toString('hex')};
  }
  if(records(Buffer.from(proposal.witness,'hex')).length&&await rpc('gettxout',[proposal.transaction.txid,0,true])){
    const candidate=await keeper.build(proposal);
    if(candidate){
      const txid=await relay(candidate.raw,candidate.action);
      if(candidate.action===2){
        const activated={...proposal,transaction:await rpc('getrawtransaction',[txid,true]),witness:nextState(Buffer.from(proposal.witness,'hex'),2,0).toString('hex')};
        const settlement=await keeper.build(activated);
        if(settlement?.action===3)await relay(settlement.raw,3);
      }
    }
  }
 }catch(error){process.stdout.write(json({observedAt:new Date().toISOString(),retry:String(error)}));}
 await new Promise(done=>setTimeout(done,30000));
}
