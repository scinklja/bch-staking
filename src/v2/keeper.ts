import {AssetIndexer,type Config,type Snapshot} from './indexer.js';
import {decision} from './model.js';
/** Version-2 browser/Node keeper coordinator. The funding callback requests explicit
 * sponsor authorization; settlement itself has no owner or administrator signature.
 * Polling inspect() is read-only. process() replays before requesting any funding.
 */
export class AssetKeeper<T> {
 constructor(readonly index:AssetIndexer,readonly funding:(config:Config,action:number,slot:number)=>Promise<T>){}
 status(snapshot:Snapshot){if(snapshot.pending.length)return {phase:'pending' as const,transactions:snapshot.pending};const next=decision(snapshot.instance,snapshot.clock);if(next.phase!=='ready')return next;return {phase:'sponsorship-required' as const,action:next.action,slot:next.slot};}
 async inspect(){return this.status(await this.index.sync());}
 async process(){const snapshot=await this.index.sync(),status=this.status(snapshot);if(status.phase!=='sponsorship-required')throw Error('V2 keeper cannot process: '+status.phase);return this.funding(snapshot.config,status.action,status.slot);}
}
