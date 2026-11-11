/** Explicit read-only capture of an existing configured chipnet vault for deterministic protocol replay. */
import { readFile, writeFile } from 'node:fs/promises';
import { ElectrumProvider, type ElectrumRequest } from '../src/electrum.js';
import { Indexer } from '../src/indexer.js';
const config = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
const responses: Record<string, unknown> = {};
class Capture extends ElectrumProvider {
  override session<T>(work: () => Promise<T>): Promise<T> {
    return super.session(async () => {
      const request = this.request;
      this.request = (async (method, ...params) => {
        const result = await request(method, ...params);
        responses[JSON.stringify([method,...params])] = result;
        return result;
      }) as ElectrumRequest;
      return work();
    });
  }
}
const provider = new Capture(), index = new Indexer(config.vaults, undefined, provider);
await index.sync();
await provider.session(async () => { await provider.header(0); await provider.header(121957); await provider.medianTime(index.blocks[0]!.height); });
await writeFile(process.argv[3]!, JSON.stringify({ capturedAt: new Date().toISOString(), endpoint: provider.endpoint, configs: config.vaults, responses, expected: { tip: index.tip, vaults: index.vaults } }, null, 2)+'\n');
console.log(JSON.stringify({endpoint:provider.endpoint,tip:index.tip?.height,vaults:index.vaults.length,requests:Object.keys(responses).length}));
