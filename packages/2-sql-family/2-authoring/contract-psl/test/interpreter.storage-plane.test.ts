import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

function interpretPostgres(schema: string) {
  const result = interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      entityTypes: testEnumEntityContributions,
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
      dataTypes: fixtureDataTypeSupport.entries,
      valueObjectStorageType: 'Jsonb',
    },
    ...fixtureInterpreterTypes,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return JSON.parse(JSON.stringify(result.value));
}

const text = { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } };

function valueObjectRef(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: 'public',
    entityKind: 'valueObject',
    entityName: name,
  };
}

const countryEnum = `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}
`;

const addressSchema = (street: string) => `${countryEnum}
type Geo {
  lat Float
}

type Address {
  ${street} String
  tags      String[]
  country   Country
  geo       Geo?
}

model User {
  id   Int     @id
  home Address
}`;

describe('SQL PSL value objects in the storage plane', () => {
  it('writes a composite type to storage, and the field refers to it by coordinate', () => {
    const contract = interpretPostgres(addressSchema('street'));
    expect({
      field: contract.domain.namespaces.public.models.User.fields.home,
      valueObjects: contract.storage.namespaces.public.entries.valueObject,
      domainKeys: Object.keys(contract.domain.namespaces.public).sort(),
    }).toEqual({
      field: { nullable: false, many: false, type: valueObjectRef('Address') },
      valueObjects: {
        Address: {
          fields: {
            street: text,
            tags: { ...text, many: { elementNullable: false } },
            country: {
              ...text,
              valueSet: {
                plane: 'storage',
                entityKind: 'valueSet',
                namespaceId: 'public',
                entityName: 'Country',
              },
            },
            geo: { nullable: true, many: false, type: valueObjectRef('Geo') },
          },
        },
        Geo: {
          fields: {
            lat: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/float8@1' } },
          },
        },
      },
      domainKeys: ['enum', 'models'],
    });
  });

  it('changes the storage hash when a member changes', () => {
    expect(interpretPostgres(addressSchema('street')).storage.storageHash).not.toBe(
      interpretPostgres(addressSchema('line1')).storage.storageHash,
    );
  });
});

const taskSchema = (variants: string) => `model Task {
  id   Int    @id
  type String

  @@discriminator(type)
}

${variants}`;

const bug = `model Bug {
  severity Int
  @@base(Task, "bug")
}
`;
const feature = `model Feature {
  priority Int
  @@base(Task, "feature")
}
`;

describe('SQL PSL discriminator value sets', () => {
  it('writes a <Base>.<field> value set of the variant values, and the column refers to it', () => {
    const contract = interpretPostgres(taskSchema(`${bug}\n${feature}`));
    const namespace = contract.storage.namespaces.public;
    expect({
      valueSet: namespace.entries.valueSet?.['Task.type'],
      column: namespace.entries.table.Task.columns.type.valueSet,
      discriminator: contract.domain.namespaces.public.models.Task.discriminator,
    }).toEqual({
      valueSet: { kind: 'valueSet', values: ['bug', 'feature'] },
      column: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'Task.type',
      },
      discriminator: { field: 'type' },
    });
  });

  it("changes the storage hash when a variant's value changes", () => {
    expect(interpretPostgres(taskSchema(bug)).storage.storageHash).not.toBe(
      interpretPostgres(taskSchema(bug.replace('"bug"', '"defect"'))).storage.storageHash,
    );
  });

  it('keeps the enum value set of an enum-typed discriminator and writes no second one', () => {
    const contract = interpretPostgres(`enum Kind {
  @@type("pg/text@1")
  Bug = "bug"
  Feature = "feature"
}

model Task {
  id   Int  @id
  type Kind

  @@discriminator(type)
}

${bug}`);
    const namespace = contract.storage.namespaces.public;
    expect({
      valueSets: Object.keys(namespace.entries.valueSet),
      column: namespace.entries.table.Task.columns.type.valueSet.entityName,
    }).toEqual({ valueSets: ['Kind'], column: 'Kind' });
  });
});
