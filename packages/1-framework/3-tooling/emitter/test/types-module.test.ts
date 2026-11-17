import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit } from './utils';

const TYPES_MODULE = '@acme/orm-db/generated-types';

function contract() {
  return createTestContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
  });
}

function importStatements(source: string): string[] {
  return [...source.matchAll(/^import type \{[^}]*\} from '[^']+';$/gms)].map(([statement]) =>
    statement.replace(/\s+/g, ' '),
  );
}

describe('the modules contract types import from', () => {
  it('imports the framework and family types, and declarations stating the same module, in one statement from the config module', async () => {
    const result = await emit(
      contract(),
      {
        codecTypeImports: [
          { package: TYPES_MODULE, named: 'CodecTypes', alias: 'TargetTypes' },
          { package: TYPES_MODULE, named: 'CodecTypes', alias: 'TargetTypes' },
        ],
      },
      createMockSpi(),
      { typesModule: TYPES_MODULE },
    );

    expect(importStatements(result.contractDts)).toEqual([
      `import type { CodecTypes as TargetTypes, Contract as ContractType, ContractWithTypeMaps, ExecutionHashBase, FieldTypesFromDomain, NamespaceId, ProfileHashBase, StorageHashBase, TypeMaps as TypeMapsType, } from '${TYPES_MODULE}';`,
    ]);
  });

  it('imports a declaration stating another module in a statement of its own', async () => {
    const result = await emit(
      contract(),
      {
        codecTypeImports: [
          { package: '@acme/orm-ext/codec-types', named: 'CodecTypes', alias: 'ExtTypes' },
        ],
      },
      createMockSpi(),
      { typesModule: TYPES_MODULE },
    );

    expect(importStatements(result.contractDts)).toEqual([
      `import type { Contract as ContractType, ContractWithTypeMaps, ExecutionHashBase, FieldTypesFromDomain, NamespaceId, ProfileHashBase, StorageHashBase, TypeMaps as TypeMapsType, } from '${TYPES_MODULE}';`,
      `import type { CodecTypes as ExtTypes } from '@acme/orm-ext/codec-types';`,
    ]);
  });
});
