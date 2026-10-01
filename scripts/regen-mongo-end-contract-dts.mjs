#!/usr/bin/env node
/**
 * Regenerates a Mongo contract's `.d.ts` file from its adjacent `.json` the
 * way `prisma contract emit` does: the contract is hydrated by the Mongo
 * family and passed to the emitter's `emit` with the Mongo control stack, so
 * the codec lookup, type imports and namespace kinds match a real emit. The
 * `.json` file is left untouched so historical storage hashes stay stable —
 * only the `.d.ts` is rewritten.
 *
 * Purely path-generic: it writes `<arg with .json replaced by .d.ts>`
 * beside each argument, whether the argument is a migrations-root-wide store
 * entry (`migrations/snapshots/<hex>/contract.json`) or a test fixture. The
 * script does not resolve the store itself and overwrites the `.d.ts`
 * unconditionally, whereas the store's writer is write-if-absent for the pair.
 *
 * Needs a prior `pnpm build`: it imports the packages' `dist` output.
 *
 * Usage:
 *   node scripts/regen-mongo-end-contract-dts.mjs <path/to/contract.json>...
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

async function importFromRepo(relPath) {
  return import(pathToFileURL(resolve(repoRoot, relPath)).href);
}

const { emit } = await importFromRepo(
  'packages/1-framework/3-tooling/emitter/dist/exports/index.mjs',
);
const { createControlStack } = await importFromRepo(
  'packages/1-framework/1-core/framework-components/dist/control.mjs',
);
const { mongoFamilyDescriptor } = await importFromRepo(
  'packages/2-mongo-family/9-family/dist/control.mjs',
);
const { mongoTargetDescriptor } = await importFromRepo(
  'packages/3-mongo-target/1-mongo-target/dist/control.mjs',
);
const { default: mongoAdapter } = await importFromRepo(
  'packages/3-mongo-target/2-mongo-adapter/dist/control.mjs',
);
const { default: mongoDriver } = await importFromRepo(
  'packages/3-mongo-target/3-mongo-driver/dist/control.mjs',
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node regen-mongo-end-contract-dts.mjs <path/to/contract.json>...');
  process.exit(1);
}

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});
const family = mongoFamilyDescriptor.create(stack);
const serializer = mongoTargetDescriptor.contractSerializer;

for (const jsonPath of args) {
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  delete json._generated;

  const { contractDts } = await emit(
    family.deserializeContract(json),
    stack,
    mongoFamilyDescriptor.emission,
    {
      serializeContract: (contract) => serializer.serializeContract(contract),
      deserializeContract: (contractJson) => family.deserializeContract(contractJson),
      ...(serializer.shouldPreserveEmpty
        ? { shouldPreserveEmpty: serializer.shouldPreserveEmpty }
        : {}),
      ...(serializer.sortStorage ? { sortStorage: serializer.sortStorage } : {}),
    },
  );

  const dtsPath = jsonPath.replace(/\.json$/, '.d.ts');
  writeFileSync(dtsPath, contractDts);
  console.error(`regenerated ${dtsPath}`);
}
