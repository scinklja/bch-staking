/// <reference lib="webworker" />
// No runtime imports: reporting must exist before ANY module or WASM can fail.
import type {WorkerDiagnostic} from './workerDiagnostics';
const scope=self as unknown as DedicatedWorkerGlobalScope;
const report=(value:unknown,phase:string)=>{
 const event=value as ErrorEvent|undefined,error=(event?.error??value) as Error|undefined;
 const detail=event?.message||error?.message||(typeof value==='string'?value:'Worker module or resource initialization failed');
 const diagnostic:WorkerDiagnostic={message:detail,filename:event?.filename||scope.location.href,line:event?.lineno,column:event?.colno,stack:error?.stack,phase};
 scope.postMessage({type:'error',fatal:true,diagnostic});
};
scope.addEventListener('error',event=>report(event,'runtime'));
scope.addEventListener('unhandledrejection',event=>{report(event.reason,'unhandled rejection');event.preventDefault();});
scope.addEventListener('messageerror',()=>report('Worker could not deserialize a message','message loading'));
void import('./arena.worker').catch(error=>report(error,'module / WASM initialization'));
