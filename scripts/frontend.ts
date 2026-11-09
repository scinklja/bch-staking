import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..',import.meta.url));
const configPath = resolve(process.argv[2] ?? `${root}/.regtest/frontend/config.json`);
try { await readFile(configPath,'utf8'); }
catch (error: any) {
  if (error.code !== 'ENOENT' || process.argv[2]) throw error;
  const evidence = JSON.parse(await readFile(`${root}/docs/keeper-indexer-test-result.json`,'utf8'));
  if (!evidence.config?.genesis) throw Error('No saved vault configuration. Supply an indexer config with keeper:false and port:3100.');
  await mkdir(dirname(configPath),{recursive:true,mode:0o700});
  await writeFile(configPath,JSON.stringify({vaults:[evidence.config],checkpoint:`${root}/.regtest/frontend/index.json`,port:3100,pollMs:10000,keeper:false},null,2)+'\n',{mode:0o600});
}
const config=JSON.parse(await readFile(configPath,'utf8'));
if(config.keeper !== false || config.port !== 3100) throw Error('Frontend startup requires an index-only config: keeper:false, port:3100.');
const { ARENA_SPONSOR_KEY: _unusedSponsorKey, ...environment } = process.env;
const api=spawn(process.execPath,['--import','tsx','scripts/arena.ts',configPath],{cwd:root,env:environment,stdio:'inherit'});
const vite=spawn(process.execPath,[`${root}/frontend/node_modules/vite/bin/vite.js`,'--host','127.0.0.1'],{cwd:`${root}/frontend`,env:environment,stdio:'inherit'});
let stopping=false;
function stop() {if(stopping)return;stopping=true;api.kill('SIGTERM');vite.kill('SIGTERM');}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
for (const child of [api,vite]) {
  child.once('error',error=>{console.error(error.message);process.exitCode=1;stop();});
  child.once('exit',(code)=>{if(!stopping){process.exitCode=code??1;stop();}});
}
console.log('Read-only frontend: http://127.0.0.1:5173 · API via /api → localhost:3100');
