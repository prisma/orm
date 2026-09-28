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
  describe('guards: passed before value-object fields were built by the contract builder', () => {
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
      const { fields, columns } = userFieldsAndColumns(result.value);
      expect({ fields, columns }).toEqual({
        fields: { id: fields?.['id'], ...addressFields },
        columns: {
          id: columns?.['id'],
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
