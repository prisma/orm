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
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const pslBlockDescriptors = { enum: testEnumPslBlockDescriptor };

function userColumns(contract: Contract, namespaceId: string) {
  return (contract.storage as SqlStorage).namespaces[namespaceId]?.entries.table?.['User']?.columns;
}

function interpretPostgres(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      entityTypes: testEnumEntityContributions,
      pslBlockDescriptors,
      dataTypes: fixtureDataTypeSupport.entries,
      valueObjectStorageType: 'Jsonb',
    },
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    ...document,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

const countryEnum = `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}
`;

describe('interpretPslDocumentToSqlContract value-object fields and composite type members', () => {
  it('gives an enum-typed composite member the domain valueSet a model field of that enum has, single and list', () => {
    const result = interpretPostgres(`${countryEnum}
type Address {
  country   Country
  countries Country[]
}

model User {
  id      Int     @id
  country Country
  home    Address
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const namespace = result.value.domain.namespaces['public'];
    const modelField = namespace?.models['User']?.fields['country'];
    expect(modelField).toEqual({
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: 'public',
        entityName: 'Country',
      },
    });
    expect(namespace?.valueObjects?.['Address']?.fields).toEqual({
      country: modelField,
      countries: { ...modelField, many: true },
    });
  });

  it('keeps many and nullable on value-object fields of a model, stored in one column of the declared type', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id        Int        @id
  home      Address?
  addresses Address[]
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect({
      fields: result.value.domain.namespaces['public']?.models['User']?.fields,
      columns: userColumns(result.value, 'public'),
    }).toEqual({
      fields: {
        id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        home: { nullable: true, type: { kind: 'valueObject', name: 'Address' } },
        addresses: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: true },
      },
      columns: {
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        home: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: true },
        addresses: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
      },
    });
  });

  it('keeps a database default on a value-object field of a model', () => {
    const result = interpretPostgres(`type Address {
  street String
}

model User {
  id   Int     @id
  home Address @default(sql\`'{}'::jsonb\`)
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect({
      field: result.value.domain.namespaces['public']?.models['User']?.fields['home'],
      column: userColumns(result.value, 'public')?.['home'],
    }).toEqual({
      field: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
      column: {
        nativeType: 'jsonb',
        codecId: 'pg/jsonb@1',
        nullable: false,
        default: { kind: 'function', expression: "'{}'::jsonb" },
      },
    });
  });

  it('stores a value-object list field of a model in the storage type the sqlite target declares', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
}

model User {
  id        Int       @id
  addresses Address[]
}`,
      sourceId: 'schema.prisma',
    });
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
      ...document,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [namespaceId] = Object.keys(result.value.storage.namespaces);
    expect({
      field: result.value.domain.namespaces[namespaceId ?? '']?.models['User']?.fields['addresses'],
      column: userColumns(result.value, namespaceId ?? '')?.['addresses'],
    }).toEqual({
      field: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: true },
      column: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: false },
    });
  });
});
