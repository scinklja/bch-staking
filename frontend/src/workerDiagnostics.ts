/** Structured-clone-safe diagnostics, including browsers that emit only a plain Event. */
export interface WorkerDiagnostic {
 message:string;filename?:string;line?:number;column?:number;stack?:string;phase?:string;
 resource?:{url:string;status?:number;contentType?:string;error?:string};
}
export function workerDiagnostic(value:unknown,filename?:string,phase?:string):WorkerDiagnostic {
 const event=value as {message?:unknown;filename?:string;lineno?:number;colno?:number;error?:unknown;stack?:string;reason?:unknown}|null;
 const nested=(event?.error??event?.reason) as {message?:unknown;stack?:string}|undefined;
 const detail=event?.message??nested?.message??(typeof event?.error==='string'?event.error:undefined)??(typeof value==='string'?value:undefined);
 return {message:typeof detail==='string'&&detail.trim()?detail:'The browser supplied no error details (worker loading, initialization or resource failure).',
  filename:event?.filename||filename,line:event?.lineno,column:event?.colno,stack:event?.stack||nested?.stack,phase};
}
export function formatWorkerDiagnostic(d:WorkerDiagnostic) {
 const location=d.filename?` ${d.filename}${d.line?`:${d.line}${d.column?`:${d.column}`:''}`:''}`:'';
 const resource=d.resource?` Resource ${d.resource.url}: ${d.resource.status??d.resource.error??'unavailable'}${d.resource.contentType?` (${d.resource.contentType})`:''}.`:'';
 return `Browser indexer worker failed: ${d.phase?`[${d.phase}] `:''}${d.message}${location}.${resource}${d.stack?`\n${d.stack}`:''} Retry with Refresh data. If loading keeps failing, reload the latest page; close unused tabs if browser memory is limited. Saved wallet and vault records are retained.`;
}
export async function probeWorkerResource(url:string):Promise<NonNullable<WorkerDiagnostic['resource']>> {
 try{const response=await fetch(url,{method:'HEAD',cache:'no-cache',credentials:'omit',signal:AbortSignal.timeout(10000)});return {url,status:response.status,contentType:response.headers.get('content-type')??undefined};}
 catch(error){return {url,error:error instanceof Error?error.message:String(error)};}
}
