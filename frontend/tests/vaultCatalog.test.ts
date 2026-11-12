import {expect,it,vi} from 'vitest';
import {localVaultRecords,saveLocalVault,sharedVault,vaultShareLink} from '../src/vaultCatalog';
import {routeFromHash} from '../src/marketplace';
const config={genesis:'a'.repeat(64),stakingCategory:'b'.repeat(64),epoch:1794409274,periodSeconds:60,periods:2,cap:2000},category='c'.repeat(64);
it('persists only verified admitted configuration, imports share hints separately and preserves the details route',()=>{
 const changed=vi.fn();window.addEventListener('arena-vault-catalog',changed);saveLocalVault(config,category);expect(localVaultRecords()).toEqual([{config,category}]);saveLocalVault(config,category);expect(changed).toHaveBeenCalledOnce();
 const url=new URL(vaultShareLink(category,config));location.hash=url.hash;expect(sharedVault()).toEqual(config);expect(routeFromHash(url.hash)).toEqual({page:'vault',id:category});window.removeEventListener('arena-vault-catalog',changed);location.hash='';
});
it('rejects malformed shared genesis and treats corrupted stored discovery as untrusted',()=>{
 localStorage.setItem('arena-chipnet-local-vaults-v1','[{"config":{}}]');expect(localVaultRecords()).toEqual([]);location.hash='#/vault/'+category+'?vault='+encodeURIComponent(JSON.stringify({...config,periods:17}));expect(()=>sharedVault()).toThrow();location.hash='';
});
