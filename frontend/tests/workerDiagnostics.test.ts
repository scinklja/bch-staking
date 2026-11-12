import {expect,it} from 'vitest';
import {workerDiagnostic,formatWorkerDiagnostic} from '../src/workerDiagnostics';
it('preserves runtime source location and stack; plain resource Events remain actionable',()=>{
 const diagnostic=workerDiagnostic({message:'out of memory',filename:'worker.js',lineno:7,colno:3,error:{stack:'at wasm'}});
 expect(diagnostic).toMatchObject({message:'out of memory',filename:'worker.js',line:7,column:3,stack:'at wasm'});
 expect(formatWorkerDiagnostic(diagnostic)).toContain('worker.js:7:3');
 for(const value of [undefined,null,new Event('error'),{message:undefined}]){
  const text=formatWorkerDiagnostic(workerDiagnostic(value,'indexer.js','loading'));
  expect(text).not.toContain('undefined');expect(text).toContain('Refresh data');expect(text).toContain('Saved wallet and vault records are retained');
 }
});
