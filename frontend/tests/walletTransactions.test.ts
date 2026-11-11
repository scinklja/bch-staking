import {expect,it} from 'vitest';
import {parseExtendedJson} from '@wizardconnect/core';
import {wizardWireTransaction} from '../src/walletTransactions';
it('encodes libauth integers and bytes before WizardConnect relay JSON serialization',()=>{
  const native={transaction:{outputs:[{valueSatoshis:187000n,lockingBytecode:new Uint8Array([0x51]),token:{amount:1000n,category:new Uint8Array(32).fill(8)}}]}};
  const wire=wizardWireTransaction(native);
  expect(()=>JSON.stringify(wire)).not.toThrow();
  expect(parseExtendedJson(JSON.stringify(wire))).toEqual(native);
});
