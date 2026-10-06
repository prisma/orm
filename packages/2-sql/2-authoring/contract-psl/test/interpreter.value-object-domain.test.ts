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
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const pslBlockDescriptors = { enum: testEnumPslBlockDescriptor };

function interpretPostgres(schema: string) {
  return interpretSqlContract(schema, {
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
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

const countryEnum = `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}
`;

describe('interpretPslDocumentToSqlContract value objects in the domain', () => {
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
      many: false,
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
      countries: { ...modelField, many: { elementNullable: false } },
    });
  });

  it('gives a composite member typed by a named type the domain type a model field of that named type has, single and list', () => {
    const result = interpretPostgres(`types {
  Short = VarChar(10)
  Email = String
}

type Label {
  code  Short
  codes Short[]
  email Email
}

model User {
  id     Int         @id
  code   Short
  inline VarChar(10)
  email  Email
  label  Label
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const namespace = result.value.domain.namespaces['public'];
    const fields = namespace?.models['User']?.fields;
    const short = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 10 } },
      many: false,
    };
    const email = { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: false };
    expect({
      code: fields?.['code'],
      inline: fields?.['inline'],
      email: fields?.['email'],
    }).toEqual({ code: short, inline: short, email });
    expect(namespace?.valueObjects?.['Label']?.fields).toEqual({
      code: short,
      codes: { ...short, many: { elementNullable: false } },
      email,
    });
  });

  it('lowers composite types to value objects, keeping optional, list and nested value-object members', () => {
    const result = interpretPostgres(`type Address {
  street String
  zip    String?
  tags   String[]
}

type ShippingInfo {
  address Address
  notes   String
}

model Order {
  id   Int          @id
  ship ShippingInfo
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = { kind: 'scalar', codecId: 'pg/text@1' };
    expect(result.value.domain.namespaces['public']?.valueObjects).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: text, many: false },
          zip: { nullable: true, type: text, many: false },
          tags: { nullable: false, type: text, many: { elementNullable: false } },
        },
      },
      ShippingInfo: {
        fields: {
          address: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: false },
          notes: { nullable: false, type: text, many: false },
        },
      },
    });
  });

  it('refuses an attribute on a composite type member and on the composite type, which neither takes', () => {
    const result = interpretPostgres(`type Address {
  street String @default("x")
  zip    String @map("postal_code")

  @@map("addresses")
}

model User {
  id   Int     @id
  home Address
}`);

    const span = (line: number, start: [number, number], end: [number, number]) => ({
      start: { offset: start[0], line, column: start[1] },
      end: { offset: end[0], line, column: end[1] },
    });
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE',
        message:
          'Composite type "Address" uses attribute "@@map", which a composite type does not take',
        sourceId: 'schema.prisma',
        span: span(5, [84, 3], [102, 21]),
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Member "street" of composite type "Address" uses attribute "@default", which a composite type member does not take',
        sourceId: 'schema.prisma',
        span: span(2, [31, 17], [44, 30]),
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Member "zip" of composite type "Address" uses attribute "@map", which a composite type member does not take',
        sourceId: 'schema.prisma',
        span: span(3, [61, 17], [80, 36]),
      },
    ]);
  });

  it('reports an attribute no component registers, on a composite type or its member, once', () => {
    const result = interpretPostgres(`type Address {
  street String @foo

  @@bar
}

model User {
  id   Int     @id
  home Address
}`);

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE',
        message:
          'Composite type "Address" uses attribute "@@bar", which a composite type does not take',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 39, line: 4, column: 3 },
          end: { offset: 44, line: 4, column: 8 },
        },
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Member "street" of composite type "Address" uses attribute "@foo", which a composite type member does not take',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 31, line: 2, column: 17 },
          end: { offset: 35, line: 2, column: 21 },
        },
      },
    ]);
  });

  it('omits valueObjects from the contract when no composite types exist', () => {
    const result = interpretPostgres(`model User {
  id Int @id
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.valueObjects).toBeUndefined();
  });
});
