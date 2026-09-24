#!/usr/bin/env node
/**
 * Regenerates a Mongo contract's `.d.ts` file by hydrating its adjacent
 * `.json` through the Mongo target serializer and re-running the emitter's
 * typedef generator. The `.json` file is left untouched so historical
 * storage hashes stay stable — only the `.d.ts` is rewritten to match the
 * post-class-flip type surface (collections carry a
 * `kind: 'mongo-collection'` discriminator, etc.).
 *
 * Purely path-generic: it writes `<arg with .json replaced by .d.ts>`
 * beside each argument, so it works unchanged whether the argument is a
 * migrations-root-wide store entry (`migrations/snapshots/<hex>/contract.json`)
 * or (pre-dedup) a per-package `end-contract.json`. Callers pass whichever
 * path is the current source of truth; the script does not resolve the
 * store itself, so there is no `writeContractSnapshot` call here — it
 * overwrites the `.d.ts` unconditionally, whereas the store's writer is
 * write-if-absent for the *pair*.
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

const prettierMod = await importFromRepo(
  'packages/1-framework/3-tooling/emitter/node_modules/prettier/index.cjs',
);
const format = prettierMod.format ?? prettierMod.default?.format;
const { generateContractDts } = await importFromRepo(
  'packages/1-framework/3-tooling/emitter/dist/exports/index.mjs',
);
const { mongoEmission } = await importFromRepo(
  'packages/2-mongo-family/3-tooling/emitter/dist/exports/index.mjs',
);
const { MongoTargetContractSerializer } = await importFromRepo(
  'packages/3-mongo-target/1-mongo-target/dist/control.mjs',
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node regen-mongo-end-contract-dts.mjs <path/to/contract.json>...');
  process.exit(1);
}

const serializer = new MongoTargetContractSerializer();

for (const jsonPath of args) {
  const raw = readFileSync(jsonPath, 'utf8');
  const json = JSON.parse(raw);
  delete json._generated;

  const contract = serializer.deserializeContract(json);

  const codecTypeImports = [
    {
      package: '@internal/target-mongo/codec-types',
      named: 'CodecTypes',
      alias: 'MongoCodecTypes',
    },
  ];

  const dtsRaw = generateContractDts(contract, mongoEmission, codecTypeImports, {
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
  });

  let dts;
  try {
    dts = await format(dtsRaw, {
      parser: 'typescript',
      singleQuote: true,
      semi: true,
      printWidth: 100,
    });
  } catch (err) {
    console.error(
      `prettier formatting failed for ${jsonPath}; writing unformatted output. Error: ${err?.message ?? err}`,
    );
    dts = dtsRaw;
  }

  const dtsPath = jsonPath.replace(/\.json$/, '.d.ts');
  writeFileSync(dtsPath, dts);
  console.error(`regenerated ${dtsPath}`);
}
