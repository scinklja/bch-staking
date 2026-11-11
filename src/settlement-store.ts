import type { IntentStore, SettlementIntent } from './browser-keeper.js';
/** Separate atomic journal: reader checkpoints cannot overwrite an in-flight submission. */
export class IndexedDbSettlementStore implements IntentStore {
  private database?:Promise<IDBDatabase>;
  private open() {
    return this.database??=new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('staking-arena-settlement-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('intents');
      request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Settlement storage is blocked by another tab'));
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    });
  }
  async load(category:string):Promise<SettlementIntent|undefined> {
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('intents'),request=tx.objectStore('intents').get(category);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async save(intent:SettlementIntent) {
    const db=await this.open();await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('intents','readwrite',{durability:'strict'});tx.objectStore('intents').put(intent,intent.category);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Settlement intent was not persisted'));
    });
  }
}
