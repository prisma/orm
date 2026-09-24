import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Contract, coreHash, crossRef, profileHash } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { blindCast } from '@internal/utils/casts';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoEmission } from '../src/index';

const codecImports = [
  {
    package: '@internal/target-mongo/codec-types',
    named: 'CodecTypes',
    alias: 'MongoCodecTypes',
  },
];

const contract: Contract = {
  ...ormContractJson,
  target: 'mongo',
  profileHash: profileHash('orm-profile'),
  roots: Object.fromEntries(
    Object.entries(ormContractJson.roots).map(([key, ref]) => [
      key,
      crossRef(ref.model, ref.namespace),
    ]),
  ),
  domain: blindCast<
    Contract['domain'],
    'orm-contract.json is a real emitted fixture; its cross-references carry plain-string namespace ids because JSON has no branded NamespaceId, same as any contract deserialized from disk'
  >(ormContractJson.domain),
  storage: {
    ...ormContractJson.storage,
    storageHash: coreHash('orm-storage'),
  },
  capabilities: {},
  extensions: {},
  meta: {},
} as Contract;

const hashes = {
  storageHash: 'orm-storage',
  profileHash: 'orm-profile',
};

const output = generateContractDts(contract, mongoEmission, codecImports, hashes);

const targets = [
  resolve(
    import.meta.dirname,
    '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.d.ts',
  ),
  resolve(import.meta.dirname, '../../../9-family/test/fixtures/orm-contract.d.ts'),
];

for (const target of targets) {
  writeFileSync(target, output);
  console.log(`Generated ${target}`);
}
