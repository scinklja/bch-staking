let worker:Worker|undefined,counter=0;
const tasks=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
/** Public read/claim API intentionally independent of a connected wallet. */
export function v3Call(intent:Record<string,unknown>,keys:unknown[]=[]):Promise<any>{
 if(!worker){worker=new Worker(new URL('./v3.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{const t=tasks.get(e.data.id);if(t){tasks.delete(e.data.id);e.data.error?t.reject(Error(e.data.error)):t.resolve(e.data.result);}};worker.onerror=()=>{for(const t of tasks.values())t.reject(Error('V3 worker failed; saved operations remain recoverable'));tasks.clear();worker?.terminate();worker=undefined;};}
 return new Promise((resolve,reject)=>{const id=++counter;tasks.set(id,{resolve,reject});worker!.postMessage({id,intent,keys});});
}
