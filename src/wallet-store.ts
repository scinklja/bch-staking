import type {WalletOperation,WalletOperationStore} from './browser-wallet.js';
/** Public transaction journal only. No wallet seed, key, xpub, relay credential or session object. */
export class IndexedDbWalletOperations implements WalletOperationStore {
 private db?:Promise<IDBDatabase>;
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('staking-arena-wallet-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Wallet journal blocked by another tab'));r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};});}
 async list(){const db=await this.open();return new Promise<WalletOperation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);t.onabort=()=>reject(t.error);r.onerror=()=>reject(r.error);});}
 async save(operation:WalletOperation){const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(operation,operation.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}
