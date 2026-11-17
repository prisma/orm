import { generateContractDts } from '@internal/emitter';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const TYPES_MODULE = '@acme/orm-db/generated-types';

const hashes = { storageHash: 'storage', profileHash: 'profile' };

const codecTypeImports: TypesImportSpec[] = [
  { package: '@acme/orm-db/codec-types', named: 'CodecTypes', alias: 'PgCodecTypes' },
  { package: '@acme/orm-vector/codec-types', named: 'CodecTypes', alias: 'PgVectorCodecTypes' },
];

function emit(): string {
  const contract = createContract({
    models: {
      User: {
        storage: {
          namespaceId: '__unbound__',
          table: 'user',
          fields: { id: { column: 'id' } },
        },
        fields: {
          id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'sql/int@1' } },
        },
        relations: {},
      },
    },
    storage: {
      tables: {
        user: {
          columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  });
  return generateContractDts(contract, sqlEmission, codecTypeImports, hashes, TYPES_MODULE);
}

function importStatements(source: string): string[] {
  return [...source.matchAll(/^import type \{[^}]*\} from '[^']+';$/gm)].map(
    ([statement]) => statement,
  );
}

describe('the modules SQL contract types import from', () => {
  it('imports the family types from the module it is given', () => {
    expect(sqlEmission.getFamilyImports(TYPES_MODULE)).toEqual([
      { symbol: 'ColumnTypesFromStorage', moduleSpecifier: TYPES_MODULE, typeOnly: true },
      { symbol: 'ContractWithTypeMaps', moduleSpecifier: TYPES_MODULE, typeOnly: true },
      { symbol: 'RelationKeys', moduleSpecifier: TYPES_MODULE, typeOnly: true },
      { symbol: 'TypeMaps', alias: 'TypeMapsType', moduleSpecifier: TYPES_MODULE, typeOnly: true },
    ]);
  });

  it('imports each codec module and the framework and family types once, in specifier order', () => {
    expect(importStatements(emit())).toEqual([
      "import type { CodecTypes as PgCodecTypes } from '@acme/orm-db/codec-types';",
      `import type { ColumnTypesFromStorage, Contract as ContractType, ContractWithTypeMaps, ExecutionHashBase, FieldTypesFromDomain, NamespaceId, ProfileHashBase, RelationKeys, StorageHashBase, TypeMaps as TypeMapsType } from '${TYPES_MODULE}';`,
      "import type { CodecTypes as PgVectorCodecTypes } from '@acme/orm-vector/codec-types';",
    ]);
  });
});

describe('the order of emitted SQL storage', () => {
  it('orders tables by code unit, whatever the locale', () => {
    const table = {
      columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    };
    const dts = generateContractDts(
      createContract({ storage: { tables: { alpha: table, Beta: table } } }),
      sqlEmission,
      [],
      hashes,
      TYPES_MODULE,
    );
    expect(dts.indexOf('readonly Beta:')).toBeLessThan(dts.indexOf('readonly alpha:'));
  });
});
