import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { type Contract, coreHash, crossRef, profileHash } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { blindCast } from '@internal/utils/casts';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import storedNamesContractJson from '../../../5-query-builders/orm/test/fixtures/stored-names-contract.json';
import migrationContractJson from '../../../9-family/test/fixtures/migration-contract.json';
import { mongoEmission } from '../src/index';

const targetCodecTypes = resolve(
  import.meta.dirname,
  '../../../../3-targets/mongo/1-target/src/exports/codec-types',
);

function codecImportsFrom(fixtureDir: string, viaPackage: boolean) {
  return [
    {
      package: viaPackage
        ? '@internal/target-mongo/codec-types'
        : relative(fixtureDir, targetCodecTypes),
      named: 'CodecTypes',
      alias: 'MongoCodecTypes',
    },
  ];
}

function fixtureContract(
  json: typeof ormContractJson | typeof storedNamesContractJson | typeof migrationContractJson,
  hash: string,
) {
  return {
    ...json,
    target: 'mongo',
    profileHash: profileHash(`${hash}-profile`),
    roots: Object.fromEntries(
      Object.entries(json.roots).map(([key, ref]) => [key, crossRef(ref.model, ref.namespace)]),
    ),
    domain: blindCast<
      Contract['domain'],
      'the fixture JSON is a real emitted fixture; its cross-references carry plain-string namespace ids because JSON has no branded NamespaceId, same as any contract deserialized from disk'
    >(json.domain),
    storage: {
      ...json.storage,
      storageHash: coreHash(`${hash}-storage`),
    },
    capabilities: {},
    extensions: {},
    meta: {},
  } as Contract;
}

const mongoContractFixtures = resolve(
  import.meta.dirname,
  '../../../1-foundation/mongo-contract/test/fixtures',
);
const familyFixtures = resolve(import.meta.dirname, '../../../9-family/test/fixtures');
const ormFixtures = resolve(import.meta.dirname, '../../../5-query-builders/orm/test/fixtures');

const fixtures = [
  {
    json: ormContractJson,
    hash: 'orm',
    targets: [
      { dir: mongoContractFixtures, file: 'orm-contract.d.ts', viaPackage: false },
      { dir: familyFixtures, file: 'orm-contract.d.ts', viaPackage: false },
    ],
  },
  {
    json: storedNamesContractJson,
    hash: 'stored-names',
    targets: [{ dir: ormFixtures, file: 'stored-names-contract.d.ts', viaPackage: true }],
  },
  {
    json: migrationContractJson,
    hash: 'migration',
    targets: [{ dir: familyFixtures, file: 'migration-contract.d.ts', viaPackage: false }],
  },
];

for (const { json, hash, targets } of fixtures) {
  for (const { dir, file, viaPackage } of targets) {
    const target = resolve(dir, file);
    writeFileSync(
      target,
      generateContractDts(
        fixtureContract(json, hash),
        mongoEmission,
        codecImportsFrom(dir, viaPackage),
        { storageHash: `${hash}-storage`, profileHash: `${hash}-profile` },
      ),
    );
    console.log(`Generated ${target}`);
  }
}
