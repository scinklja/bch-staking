import {Network,type NetworkProvider} from 'cashscript';
export type V3Network='chipnet'|'regtest';
/** No generic testnet or mainnet fallback: both supported chains have pinned Electrum identities. */
export function v3Network(provider:Pick<NetworkProvider,'network'>):V3Network {
 if(provider.network===Network.CHIPNET)return 'chipnet';
 if(provider.network===Network.REGTEST)return 'regtest';
 throw Error('V3 supports chipnet and local regtest only; mainnet is disabled');
}
export function v3Storage(kind:'wallet'|'claims'|'configs',network:V3Network){
 if(!['chipnet','regtest'].includes(network))throw Error('Unsupported v3 storage network');
 // Keep existing regtest journals recoverable. Never import them into chipnet.
 return `staking-arena-${kind==='configs'?'v3-configs':kind+'-v3'}${network==='regtest'?'':'-chipnet'}`;
}
