import {expect,it} from 'vitest';
import {browserConfig} from '../src/browserConfig';
import {envelopeSchema} from '../src/model';
import {registrationAllowed,vaultStatus} from '../src/marketplace';
import {saveSnapshot,loadSnapshot} from '../src/snapshot';
import {fixture} from './fixture';
it('uses deployment display thresholds, defaults to zero, and rejects invalid values',()=>{
 expect(browserConfig({}).minDisplayConfirmations).toBe(0);
 expect(browserConfig({VITE_MIN_DISPLAY_CONFIRMATIONS:'1'}).minDisplayConfirmations).toBe(1);
 expect(browserConfig({VITE_MIN_DISPLAY_CONFIRMATIONS:'6'}).minDisplayConfirmations).toBe(6);
 for(const value of ['-1','0.5','NaN','Infinity'])expect(()=>browserConfig({VITE_MIN_DISPLAY_CONFIRMATIONS:value})).toThrow();
});
it('accepts explicit pending metadata, labels pending vaults, disables spending, and never restores pending snapshots',()=>{
 const data={...fixture(),confirmedOnly:false,minDisplayConfirmations:0};
 const vault={...data.vaults[0],confirmations:0,transactionStatus:'unconfirmed' as const};
 data.vaults=[vault];expect(envelopeSchema.safeParse(data).success).toBe(true);
 expect(vaultStatus(vault,data.tip)).toContain('Unconfirmed (0-conf)');
 expect(registrationAllowed(vault,data.tip,false)).toBe(false);
 saveSnapshot('/pending',data,Date.now());expect(loadSnapshot('/pending')).toBeUndefined();
 expect(envelopeSchema.safeParse({...data,minDisplayConfirmations:1}).success).toBe(false);
});
