#!/usr/bin/env node
/**
 * Regenerates a Mongo contract's `.d.ts` file from its adjacent `.json` the
 * way `prisma contract emit` does: the contract is hydrated by the family of
 * the config given by `--config` and passed to the emitter's `emit` with that
 * config's control stack, so the codec lookup, type imports and namespace
 * kinds match a real emit. The `.json` file is left untouched so historical
 * storage hashes stay stable; only the `.d.ts` is rewritten.
 *
 * It writes `<arg with .json replaced by .d.ts>` beside each argument,
 * whether the argument is a migrations-root-wide store entry
 * (`migrations/snapshots/<hex>/contract.json`) or a test fixture. A store
 * entry gets the declarations in the store's single-line form. The script
 * overwrites the `.d.ts` unconditionally, whereas the store's writer is
 * write-if-absent for the pair.
 *
 * Needs a prior `pnpm build`: it imports the packages' `dist` output.
 *
 * The declarations import the framework and family types from that config's
 * `contract.typesModule`.
 *
 * Usage:
 *   node scripts/regen-mongo-end-contract-dts.mjs --config <path/to/prisma.config.ts> <path/to/contract.json>...
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
const { contractSnapshotFiles } = await importFromRepo(
  'packages/1-framework/3-tooling/migration/dist/exports/contract-snapshot-store.mjs',
);
const { loadConfig } = await importFromRepo(
  'packages/1-framework/3-tooling/config-loader/dist/exports/index.mjs',
);

const [flag, configPath, ...args] = process.argv.slice(2);
if (flag !== '--config' || configPath === undefined || args.length === 0) {
  console.error(
    'usage: node regen-mongo-end-contract-dts.mjs --config <path/to/prisma.config.ts> <path/to/contract.json>...',
  );
  process.exit(1);
}

const loaded = await loadConfig(resolve(configPath));
if (!loaded.ok) {
  console.error(loaded.failure.message);
  process.exit(1);
}
const config = loaded.value.config;
const typesModule = config.contract?.typesModule;
if (typesModule === undefined) {
  console.error(`${configPath} names no contract.typesModule`);
  process.exit(1);
}

const stack = createControlStack({
  family: config.family,
  target: config.target,
  adapter: config.adapter,
  driver: config.driver,
  extensions: config.extensions ?? [],
});
const family = config.family.create(stack);
const serializer = config.target.contractSerializer;

for (const jsonPath of args) {
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  delete json._generated;

  const { contractDts } = await emit(
    family.deserializeContract(json),
    stack,
    config.family.emission,
    {
      serializeContract: (contract) => serializer.serializeContract(contract),
      deserializeContract: (contractJson) => family.deserializeContract(contractJson),
      typesModule,
      ...(serializer.normalizeStorage ? { normalizeStorage: serializer.normalizeStorage } : {}),
    },
  );

  const dtsPath = jsonPath.replace(/\.json$/, '.d.ts');
  const isStoreEntry = /\/migrations\/snapshots\/[0-9a-f]{64}\/contract\.json$/.test(
    resolve(jsonPath),
  );
  writeFileSync(
    dtsPath,
    isStoreEntry
      ? contractSnapshotFiles({ contractJson: json, contractDts }).contractDts
      : contractDts,
  );
  console.error(`regenerated ${dtsPath}`);
}
