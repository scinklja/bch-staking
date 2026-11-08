import { readFile, writeFile } from 'node:fs/promises';
import { compileFile, compileString, utils } from 'cashc';

// Pin the actual child covenant opcodes in the parent, not a caller/genesis-selected template.
const children = ['StakeAllocation', 'StakePool', 'LegacyRegistry', 'RegistryDeposit'];
let source = await readFile('contracts/Registry.template.cash', 'utf8');
for (const name of children) {
  const artifact = compileFile(`contracts/${name}.cash`);
  await writeFile(`artifacts/${name}.json`, JSON.stringify(artifact, null, 2) + '\n');
  const body = Buffer.from(utils.asmToBytecode(artifact.bytecode)).toString('hex');
  source = source.replaceAll(`__${name.toUpperCase()}_BODY__`, body);
}
if (/__[A-Z_]+__/.test(source)) throw new Error('Unresolved covenant template');
await writeFile('contracts/Registry.cash', source);
const registry = compileString(source);
await writeFile('artifacts/Registry.json', JSON.stringify(registry, null, 2) + '\n');
