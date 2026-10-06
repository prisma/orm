import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresCodecLookup,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarAuthoringTypes,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
} from './fixtures';

function userFieldsAndColumns(contract: Contract) {
  const [namespaceId = ''] = Object.keys(contract.storage.namespaces);
  return {
    fields: contract.domain.namespaces[namespaceId]?.models['User']?.fields,
    columns: (contract.storage as SqlStorage).namespaces[namespaceId]?.entries.table?.['User']
      ?.columns,
  };
}

const jsonbStorage = { valueObjectStorageType: 'Jsonb' } as const;

function interpretPostgres(
  schema: string,
  valueObjectStorage: { readonly valueObjectStorageType?: string } = jsonbStorage,
) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      dataTypes: fixtureDataTypeSupport.entries,
      ...valueObjectStorage,
    },
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

const userWithAddresses = `type Address {
  street String
}

model User {
  id        Int       @id
  home      Address?
  addresses Address[]
}`;

const idField = { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' }, many: false };
const idColumn = { many: false, nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
const addressFields = {
  home: { nullable: true, type: { kind: 'valueObject', name: 'Address' }, many: false },
  addresses: {
    nullable: false,
    type: { kind: 'valueObject', name: 'Address' },
    many: { elementNullable: false },
  },
};

describe('interpretPslDocumentToSqlContract value-object storage', () => {
  describe('value-object fields keep the target-declared storage column', () => {
    it('stores a value-object field, optional or list, in one column of the storage type the stack declares', () => {
      const result = interpretPostgres(userWithAddresses);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(userFieldsAndColumns(result.value)).toEqual({
        fields: { id: idField, ...addressFields },
        columns: {
          id: idColumn,
          home: { many: false, nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: true },
          addresses: { many: false, nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
        },
      });
    });

    it('stores value-object fields in the storage type the sqlite target declares', () => {
      const result = interpretSqlContract(userWithAddresses, {
        target: sqliteTarget,
        scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        authoringContributions: {
          type: sqliteScalarAuthoringTypes,
          valueObjectStorageType: 'Json',
        },
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        capabilities: { sql: {} },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(userFieldsAndColumns(result.value)).toEqual({
        fields: {
          id: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'sqlite/integer@1' },
            many: false,
          },
          ...addressFields,
        },
        columns: {
          id: { many: false, nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
          home: { many: false, nativeType: 'text', codecId: 'sqlite/json@1', nullable: true },
          addresses: { many: false, nativeType: 'text', codecId: 'sqlite/json@1', nullable: false },
        },
      });
    });

    it('keeps a database default on a value-object field', () => {
      const result = interpretPostgres(`type Address {
  street String
}

model User {
  id   Int     @id
  home Address @default(sql\`'{}'::jsonb\`)
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(userFieldsAndColumns(result.value)).toEqual({
        fields: {
          id: idField,
          home: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: false },
        },
        columns: {
          id: idColumn,
          home: {
            many: false,
            nativeType: 'jsonb',
            codecId: 'pg/jsonb@1',
            nullable: false,
            default: { kind: 'function', expression: "'{}'::jsonb" },
          },
        },
      });
    });
  });

  it('reads a list literal and a JSON literal as the same default of the one column of a list of value objects', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id       Int       @id
  emptyA   Address[] @default([])
  emptyB   Address[] @default(json\`[]\`)
  filledA  Address[] @default([json\`{"street": "x"}\`])
  filledB  Address[] @default(json\`[{"street": "x"}]\`)
}`);

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) return;
    const jsonbWithDefault = (value: unknown) => ({
      many: false,
      nativeType: 'jsonb',
      codecId: 'pg/jsonb@1',
      nullable: false,
      default: { kind: 'literal', value },
    });
    expect(userFieldsAndColumns(result.value).columns).toEqual({
      id: idColumn,
      emptyA: jsonbWithDefault([]),
      emptyB: jsonbWithDefault([]),
      filledA: jsonbWithDefault([{ street: 'x' }]),
      filledB: jsonbWithDefault([{ street: 'x' }]),
    });
  });

  it('refuses a list literal as the default of a single value object', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id   Int     @id
  home Address @default([])
}`);

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'Field "User.home": pg/jsonb has no cast from a list; it casts from pg/json',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 81, line: 7, column: 16 },
          end: { offset: 93, line: 7, column: 28 },
        },
      },
    ]);
  });

  it('links a multi-table-inheritance variant to a base keyed by a value-object field', () => {
    const result = interpretPostgres(`type Key {
  a Int
}

model Base {
  key  Key    @id
  kind String

  @@discriminator(kind)
}

model Child {
  extra String

  @@base(Base, "child")
  @@map("child")
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.models['Child']?.fields).toEqual({
      extra: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: false },
    });
    const tables = (result.value.storage as SqlStorage).namespaces['public']?.entries.table;
    expect(tables?.['child']).toEqual({
      columns: {
        key: { many: false, nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
        extra: { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      },
      primaryKey: { columns: ['key'] },
      uniques: [],
      indexes: [],
      foreignKeys: [
        {
          source: { namespaceId: 'public', tableName: 'child', columns: ['key'] },
          target: { namespaceId: 'public', tableName: 'Base', columns: ['key'] },
          onDelete: 'cascade',
        },
      ],
    });
  });

  it('refuses each value-object field when the stack declares no value-object storage type', () => {
    // The scalar map still contains Jsonb/Json entries; the family layer
    // must not fall back to hardcoded type names.
    const result = interpretPostgres(userWithAddresses, {});

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "User.home" is typed by the composite type "Address", but the adapter of the stack declares no storage type for value objects, so the field has no column to be stored in.',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 75, line: 7, column: 3 },
          end: { offset: 93, line: 7, column: 21 },
        },
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "User.addresses" is typed by the composite type "Address", but the adapter of the stack declares no storage type for value objects, so the field has no column to be stored in.',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 96, line: 8, column: 3 },
          end: { offset: 115, line: 8, column: 22 },
        },
      },
    ]);
  });
});
