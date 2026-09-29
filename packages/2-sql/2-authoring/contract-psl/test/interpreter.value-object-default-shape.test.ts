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
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const types = `enum Role {
  @@type("pg/text@1")
  A = "a"
  B = "b"
}

type Address {
  street String
  zip    String?
  tags   String[]
}

type Outer {
  inner Address
  count Int
}

type Amounts {
  price   Decimal
  cents   Numeric(10, 2)
  big     BigInt
  payload Json
  role    Role
}
`;

function diagnosticsOf(fields: string, extraTypes = '') {
  const result = interpretPslDocumentToSqlContract({
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      entityTypes: testEnumEntityContributions,
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
      dataTypes: fixtureDataTypeSupport.entries,
      valueObjectStorageType: 'Jsonb',
    },
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
    ...symbolTableInputFromParseArgs({
      schema: `${types}${extraTypes}
model User {
  id Int @id
${fields}
}`,
      sourceId: 'schema.prisma',
    }),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

const incompatible = (message: string) => ({ code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE', message });
const invalidLiteral = (message: string) => ({ code: 'PSL_INVALID_DEFAULT_LITERAL', message });
const amounts = (members: string) =>
  `{"price": "1.5", "cents": "1.50", "big": "1", "payload": {}, "role": "a"${members}}`;

describe('a default on a value-object field matches its composite type', () => {
  it('accepts values with every required member, an absent optional member, a list member and a nested value object', () => {
    expect(
      diagnosticsOf(`  home  Address   @default(json\`{"street": "x", "tags": []}\`)
  homes Address[] @default([json\`{"street": "x", "zip": null, "tags": ["a"]}\`])
  outer Outer     @default(json\`{"inner": {"street": "x", "tags": []}, "count": 1}\`)`),
    ).toEqual([]);
  });

  it('refuses a JSON object or string as the default of a list of value objects', () => {
    expect(
      diagnosticsOf(`  homes Address[] @default(json\`{"street": "x", "tags": []}\`)
  names Address[] @default(json\`"x"\`)`),
    ).toEqual([
      incompatible(
        'Field "User.homes": the default of a list of value objects is a JSON array, not a JSON object',
      ),
      incompatible(
        'Field "User.names": the default of a list of value objects is a JSON array, not a JSON string',
      ),
    ]);
  });

  it('refuses a JSON array as the default of a single value object', () => {
    expect(diagnosticsOf('  home Address @default(json`[1]`)')).toEqual([
      incompatible(
        'Field "User.home": the default of a value object is a JSON object, not a JSON array',
      ),
    ]);
  });

  it('refuses an element of a list default that is not a JSON object', () => {
    expect(diagnosticsOf('  homes Address[] @default([json`1`])')).toEqual([
      incompatible(
        'Field "User.homes[0]": a value of "Address" is a JSON object, not a JSON number',
      ),
    ]);
  });

  it('refuses a key that is not a member, and a required member with no value', () => {
    expect(diagnosticsOf('  home Address @default(json`{"street": "x", "city": "y"}`)')).toEqual([
      incompatible('Field "User.home": "city" is not a member of "Address"'),
      incompatible(
        'Field "User.home.tags": the member is required, and the default has no value for it',
      ),
    ]);
  });

  it('accepts each member value in the stored form its codec reads: decimal and big integer strings, and any JSON value in a JSON member', () => {
    expect(
      diagnosticsOf(`  a Amounts @default(json\`${amounts('')}\`)
  s Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": "x", "role": "b"}\`)
  n Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": 1, "role": "a"}\`)
  t Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": true, "role": "a"}\`)
  l Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": [1], "role": "a"}\`)
  z Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": null, "role": "a"}\`)`),
    ).toEqual([]);
  });

  it('refuses a member value its codec does not read, with the codec message', () => {
    expect(
      diagnosticsOf(
        '  a Amounts @default(json`{"price": 1.5, "cents": 1.5, "big": 1, "payload": {}, "role": "a"}`)',
      ),
    ).toEqual([
      invalidLiteral('Field "User.a.price": value must be text'),
      invalidLiteral('Field "User.a.cents": value must be text'),
      invalidLiteral('Field "User.a.big": value must be text'),
    ]);
  });

  it('refuses an enum member value that is not a value of the enum', () => {
    expect(
      diagnosticsOf(
        '  a Amounts @default(json`{"price": "1.5", "cents": "1.50", "big": "1", "payload": {}, "role": "Z"}`)',
      ),
    ).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Field "User.a.role": Expected one of: "a" | "b"',
      },
    ]);
  });

  it('accepts JSON null as the default of an optional value object or list of them, and refuses it on a required one', () => {
    expect(
      diagnosticsOf(`  a Address?   @default(json\`null\`)
  b Address[]? @default(json\`null\`)
  c Address    @default(json\`null\`)
  d Address[]  @default(json\`null\`)`),
    ).toEqual([
      incompatible('Field "User.c": the default of a value object is a JSON object, not null'),
      incompatible(
        'Field "User.d": the default of a list of value objects is a JSON array, not null',
      ),
    ]);
  });

  it('refuses null for a required member and a non-array for a list member', () => {
    expect(diagnosticsOf('  home Address @default(json`{"street": null, "tags": "a"}`)')).toEqual([
      incompatible(
        'Field "User.home.street": the member is not optional, so its value is not null',
      ),
      incompatible(
        'Field "User.home.tags": the member is a list, so its value is a JSON array, not a JSON string',
      ),
    ]);
  });

  it('reports a member whose type does not resolve where it is declared, and not again in a default that sets it', () => {
    expect(
      diagnosticsOf(
        '  x Broken @default(json`{"b": 1, "s": "x"}`)',
        'type Broken {\n  b Foo\n  s String\n}\n',
      ),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "Foo"' },
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: 'Field "Broken.b" type "Foo" is not supported',
      },
    ]);
  });

  it('checks a nested value object, each member value with its codec, and each list element', () => {
    expect(
      diagnosticsOf(
        '  outer Outer @default(json`{"inner": {"street": 1, "tags": [true, null], "zip": {}}, "count": "x"}`)',
      ),
    ).toEqual([
      invalidLiteral('Field "User.outer.inner.street": value must be text'),
      invalidLiteral('Field "User.outer.inner.zip": value must be text'),
      invalidLiteral('Field "User.outer.inner.tags[0]": value must be text'),
      incompatible('Field "User.outer.inner.tags[1]": an element of the member is not null'),
      invalidLiteral('Field "User.outer.count": value must be a whole number'),
    ]);
  });
});
