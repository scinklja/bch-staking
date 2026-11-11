import { join } from 'node:path';
import { appendFile,mkdir } from 'node:fs/promises';
import { networkConfig } from './rpc.js';
/** Call only following actual BCHN acceptance, never from local VM simulations. */
export async function recordChipnetBroadcast(label:string,txid:string) {
  if(networkConfig().network!=='chipnet') return;
  const directory=process.env.ARENA_DATA_DIR??'.chipnet';
  await mkdir(directory,{recursive:true,mode:0o700});
  await appendFile(join(directory,'broadcasts.jsonl'),JSON.stringify({observedAt:new Date().toISOString(),label,txid,status:'BCHN-accepted-broadcast'})+'\n',{mode:0o600});
}
