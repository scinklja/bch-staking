/** Public chain identity/freshness check only. No wallet, transaction or broadcast calls. */
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {writeFile} from 'node:fs/promises';
const provider=new BrowserElectrumProvider({network:'chipnet'}),results=[];
for(const endpoint of provider.endpoints){
 try{results.push(await provider.session(async()=>{const tip=await provider.tip();return {endpoint,genesis:(await provider.header(0)).hash,forkCheckpoint:(await provider.header(121957)).hash,tip:tip.hash,height:tip.height,mtp:await provider.medianTime(tip.height,tip.hash)};},endpoint));}
 catch(error){results.push({endpoint,error:String(error)});}
}
const verified=results.filter(r=>'tip'in r);
const result={verifiedAt:new Date().toISOString(),network:'chipnet',broadcasts:0,results,agreeingProviders:verified.length>=2&&verified[0]!.tip===verified[1]!.tip};
console.log(JSON.stringify(result,null,2));
await writeFile('docs/staking-arena-v3-chipnet-readonly.json',JSON.stringify(result,null,2)+'\n');
if(!result.agreeingProviders)process.exitCode=1;
