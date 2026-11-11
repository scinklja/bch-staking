import type { Checkpoint, CheckpointStore } from './indexer-core.js';

/** One complete candidate per atomic IndexedDB transaction. No partial history is published. */
export class IndexedDbCheckpoints implements CheckpointStore {
  cached?: Checkpoint;
  private database?: Promise<IDBDatabase>;
  constructor(readonly key: string) {}
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve,reject) => {
      const request = indexedDB.open('staking-arena-electrum-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
      request.onerror = () => reject(request.error ?? Error('IndexedDB unavailable'));
      request.onblocked = () => reject(Error('IndexedDB upgrade blocked by another tab; close older tabs'));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  async load(): Promise<Checkpoint | undefined> {
    const db = await this.open();
    this.cached = await new Promise<Checkpoint | undefined>((resolve,reject) => {
      const tx = db.transaction('checkpoints','readonly'), request = tx.objectStore('checkpoints').get(this.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error ?? Error('IndexedDB read aborted'));
    });
    return this.cached;
  }
  async save(value: Checkpoint) {
    const db = await this.open();
    await new Promise<void>((resolve,reject) => {
      const tx = db.transaction('checkpoints','readwrite', {durability:'strict'});
      tx.objectStore('checkpoints').put(value,this.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? Error('IndexedDB write aborted; snapshot not published'));
    });
    this.cached = value;
  }
}
