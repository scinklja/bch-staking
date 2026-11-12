import type {VaultConfig} from '../../src/arena-core';
import {validateVaultParameters} from '../../src/wallet-terms';
const key='arena-chipnet-local-vaults-v1';
interface LocalVault {category:string;config:VaultConfig}
export function localVaultRecords():LocalVault[] {
 try {const list=JSON.parse(localStorage.getItem(key)??'[]');if(!Array.isArray(list)||list.length>30)throw Error('Invalid local catalog');for(const entry of list){validateVaultParameters(entry.config);if(!/^[a-f0-9]{64}$/.test(entry.config.genesis)||!/^[a-f0-9]{64}$/.test(entry.category))throw Error('Invalid local vault');}return list;}catch{return [];}
}
export function saveLocalVault(config:VaultConfig,category?:string) {
 validateVaultParameters(config);if(!category||!/^[a-f0-9]{64}$/.test(category)||!/^[a-f0-9]{64}$/.test(config.genesis))throw Error('Canonical category required for discovery');
 if(localVaultRecords().some(v=>v.category===category&&JSON.stringify(v.config)===JSON.stringify(config)))return;
 const current=localVaultRecords().filter(v=>v.category!==category&&v.config.genesis!==config.genesis);if(current.length>=30)throw Error('Local vault limit reached; export existing links before removing entries');
 try{localStorage.setItem(key,JSON.stringify([...current,{category,config}]));}catch{throw Error('Vault discovery could not be saved. Export the recovery/configuration record and import it later.');}
 window.dispatchEvent(new Event('arena-vault-catalog'));
}
export function sharedVault():VaultConfig|undefined {
 const value=new URLSearchParams(location.hash.split('?')[1]??'').get('vault');if(!value)return;
 if(value.length>1500)throw Error('Oversized vault import');const config=JSON.parse(value);validateVaultParameters(config);if(!/^[a-f0-9]{64}$/.test(config.genesis))throw Error('Invalid shared genesis');return config;
}
export const vaultShareLink=(category:string,config:VaultConfig)=>location.origin+location.pathname+'#/vault/'+category+'?vault='+encodeURIComponent(JSON.stringify(config));
