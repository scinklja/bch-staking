import { assertNetwork, networkConfig, rpc } from '../src/rpc.js';
import { json } from '../src/arena.js';
import { writeFile,readFile } from 'node:fs/promises';
if (networkConfig().network !== 'chipnet') throw Error('This command requires chipnet');
const info = await assertNetwork();
const network = await rpc('getnetworkinfo');
const peers = await rpc('getpeerinfo');
const indexes = await rpc('getindexinfo');
let ready = false, readinessError = '';
try { await assertNetwork(true); ready = true; } catch (error) { readinessError = String(error); }
let receipts: any[] = [];
try { receipts=(await readFile('.chipnet/broadcasts.jsonl','utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); } catch(error:any) { if(error.code!=='ENOENT')throw error; }
const broadcasts=[];
for(const receipt of receipts){
  const tx=await rpc('getrawtransaction',[receipt.txid,true]);
  broadcasts.push({...receipt,confirmations:tx.confirmations??0,confirmationBlock:tx.blockhash??null});
}
const evidence = { observedAt: new Date().toISOString(), network: 'chipnet', node: network.subversion,
  chain: info.chain, blocks: info.blocks, headers: info.headers, tip: info.bestblockhash,
  mtp: info.mediantime, initialBlockDownload: info.initialblockdownload, ready, readinessError,
  indexes, peerCount: peers.length, relayPeers: peers.filter((p: any) => p.relaytxes).length,
  cashTokensActiveByHeight: info.blocks >= 121957, warnings: info.warnings,
  broadcasts, pendingTransactions: broadcasts.filter(tx=>!tx.confirmations), confirmedTransactions: broadcasts.filter(tx=>tx.confirmations>0), localSimulationReport: 'chipnet-local-verification.json',
};
if (process.argv[2] === 'record') await writeFile('docs/chipnet-verification.json', json(evidence));
process.stdout.write(json(evidence));
