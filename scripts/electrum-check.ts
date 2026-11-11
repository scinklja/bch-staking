import { ElectrumProvider } from '../src/electrum.js';
const provider = new ElectrumProvider();
console.log(JSON.stringify(await provider.session(async () => {
  const tip = await provider.tip();
  const txid = await provider.request('blockchain.transaction.id_from_pos', tip.height, 0, false);
  const tx = await provider.transaction(txid, tip.height);
  const script = tx.vout[0].scriptPubKey.hex;
  const history = await provider.history(script);
  const utxos = await provider.getUtxosForLockingBytecode(script);
  return { verifiedAt: new Date().toISOString(), endpoint: provider.endpoint, tip, txid, outputs: tx.vout.length, historyEntries: history.length, utxos: utxos.length, methods: ['server.version','blockchain.block.header','blockchain.headers.subscribe','blockchain.transaction.id_from_pos','blockchain.transaction.get','blockchain.transaction.get_merkle','blockchain.scripthash.get_history','blockchain.scripthash.listunspent'], vaultVerified: false };
}), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
