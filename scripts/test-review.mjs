// Complete local review gate. No deployment, live-chain verification or live-wallet signing.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
const id=new Date().toISOString().replaceAll(':','-'),directory=resolve('.regtest/review',id);
await mkdir(directory,{recursive:true});
const env={...process.env,CI:'1',ARENA_NETWORK:'regtest',ARENA_BROWSER_PORT:'5189'};
for(const name of ['ARENA_LIVE_URL','ARENA_TEST_API','ARENA_SPONSOR_KEY'])delete env[name];
const stages=[
 ['protocol-contracts-regtest',['test']],
 ['frontend-unit',['run','frontend:test']],
 ['browser-ui',['--prefix','frontend','run','test:browser']],
 ['production-static',['--prefix','frontend','run','test:static']],
 ['production-static-smoke',['--prefix','frontend','run','test:static:browser']],
 ['browser-indexer',['--prefix','frontend','run','test:electrum']],
 ['v3-browser-indexer',['--prefix','frontend','run','test:v3:browser']],
 ['production-build',['run','frontend:build']],
];
const report={startedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),directory,liveBroadcasts:false,stages:[],status:'running'};
const save=async()=>{await writeFile(resolve(directory,'summary.json'),JSON.stringify(report,null,2)+'\n');await writeFile('.regtest/review/latest.json',JSON.stringify(report,null,2)+'\n');};
for(const [name,args]of stages){
 const entry={name,command:'npm '+args.join(' '),startedAt:new Date().toISOString(),exitCode:null,log:resolve(directory,name+'.log')};
 report.stages.push(entry);await save();console.log(`[review] START ${name}; log ${entry.log}`);
 const log=createWriteStream(entry.log);
 entry.exitCode=await new Promise((done,reject)=>{const child=spawn('npm',args,{env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',reject);child.once('exit',(code)=>done(code??1));}).catch(error=>{log.write(String(error)+'\n');return 1;});
 await new Promise(done=>log.end(done));entry.finishedAt=new Date().toISOString();console.log(`[review] ${entry.exitCode===0?'PASS':'FAIL'} ${name}`);
 if(entry.exitCode!==0){report.status='failed';report.finishedAt=new Date().toISOString();await save();process.exit(1);}await save();
}
report.status='passed';report.finishedAt=new Date().toISOString();await save();console.log('[review] COMPLETE: all stages passed');
