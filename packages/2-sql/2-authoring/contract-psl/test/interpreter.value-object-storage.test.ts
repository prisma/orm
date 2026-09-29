import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarAuthoringTypes,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
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
  return interpretPslDocumentToSqlContract({
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
    ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
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

const idField = { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
const idColumn = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
const addressFields = {
  home: { nullable: true, type: { kind: 'valueObject', name: 'Address' } },
  addresses: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: true },
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
          home: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: true },
          addresses: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
        },
      });
    });

    it('stores value-object fields in the storage type the sqlite target declares', () => {
      const result = interpretPslDocumentToSqlContract({
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
        ...symbolTableInputFromParseArgs({ schema: userWithAddresses, sourceId: 'schema.prisma' }),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(userFieldsAndColumns(result.value)).toEqual({
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/integer@1' } },
          ...addressFields,
        },
        columns: {
          id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
          home: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: true },
          addresses: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: false },
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
          home: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
        },
        columns: {
          id: idColumn,
          home: {
            nativeType: 'jsonb',
            codecId: 'pg/jsonb@1',
            nullable: false,
            default: { kind: 'function', expression: "'{}'::jsonb" },
          },
        },
      });
    });
  });

  it('reads a default on a list of value objects as the default of its one column', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id    Int       @id
  homes Address[] @default(json\`[{"street": "x"}]\`)
}`);

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(userFieldsAndColumns(result.value).columns).toEqual({
      id: idColumn,
      homes: {
        nativeType: 'jsonb',
        codecId: 'pg/jsonb@1',
        nullable: false,
        default: { kind: 'literal', value: [{ street: 'x' }] },
      },
    });
  });

  it('refuses a list literal as the default of a list of value objects, whose one column holds no list', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id    Int       @id
  homes Address[] @default([])
}`);

    expect(
      result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE',
        message: 'Field "User.homes": pg/jsonb has no cast from a list; it casts from pg/json',
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
    const tables = (result.value.storage as SqlStorage).namespaces['public']?.entries.table;
    expect(tables?.['child']).toEqual({
      columns: {
        key: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
        extra: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
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

  it('skips value-object fields when the stack declares no value-object storage type', () => {
    // The scalar map still contains Jsonb/Json entries; the family layer
    // must not fall back to hardcoded type names.
    const result = interpretPostgres(userWithAddresses, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(userFieldsAndColumns(result.value)).toEqual({
      fields: { id: idField },
      columns: { id: idColumn },
    });
  });
});
