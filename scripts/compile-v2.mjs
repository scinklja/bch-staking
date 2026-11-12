import {readFile,writeFile} from 'node:fs/promises';
import {compileFile,compileString,utils} from 'cashc';
const bodies={};
for(const name of ['AssetRoleV2','StakeAllocationV2','RegistryV2','RegistryGenesisV2']) {
 let source;
 if(name==='RegistryV2'||name==='RegistryGenesisV2') {
  source=await readFile(`contracts/v2/${name}.template.cash`,'utf8');
  for(const [key,body] of Object.entries(bodies))source=source.replaceAll(`__${key.toUpperCase()}_BODY__`,body);
  source=source.replaceAll('__EMPTY_STATE__','00'.repeat(1574));
  if(/__[A-Z0-9_]+__/.test(source))throw Error('Unresolved v2 covenant template');
 }
 const artifact=source?compileString(source):compileFile(`contracts/v2/${name}.cash`);
 bodies[name]=Buffer.from(utils.asmToBytecode(artifact.bytecode)).toString('hex');
 await writeFile(`artifacts/${name}.json`,JSON.stringify(artifact,null,2)+'\n');
}
