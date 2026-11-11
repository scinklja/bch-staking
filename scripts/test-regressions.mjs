// Separate network groups before module imports construct their shared providers.
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const files=(await readdir(new URL('../tests/',import.meta.url))).filter(name=>name.endsWith('.test.ts')).sort();
for(const network of ['regtest','chipnet']) {
  const selected=files.filter(name=>name.startsWith('chipnet')===(network==='chipnet')).map(name=>'tests/'+name);
  if(!selected.length)continue;
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...selected],{stdio:'inherit',env:{...process.env,ARENA_NETWORK:network}});
    child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));
  });
  if(status!==0)process.exit(Number(status));
}
