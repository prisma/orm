import { generateContractDts } from '@internal/emitter';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const TYPES_MODULE = '@acme/orm-db/generated-types';

const codecTypeImports: TypesImportSpec[] = [
  { package: TYPES_MODULE, named: 'CodecTypes', alias: 'MongoCodecTypes' },
];

describe('the modules Mongo contract types import from', () => {
  it('imports the framework, family and codec types stating the same module in one statement', () => {
    const dts = generateContractDts(
      createMongoContract(),
      mongoEmission,
      codecTypeImports,
      { storageHash: 'storage', profileHash: 'profile' },
      TYPES_MODULE,
    );

    expect([...dts.matchAll(/^import type \{[^}]*\} from '[^']+';$/gm)].map(([s]) => s)).toEqual([
      `import type { CodecTypes as MongoCodecTypes, Contract as ContractType, ExecutionHashBase, FieldTypesFromDomain, MongoCollection, MongoContractWithTypeMaps, MongoTypeMaps, NamespaceId, ProfileHashBase, RelationKeys, StorageHashBase } from '${TYPES_MODULE}';`,
    ]);
  });
});
