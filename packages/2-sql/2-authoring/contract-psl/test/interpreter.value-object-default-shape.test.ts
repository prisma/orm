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

type Span = {
  readonly start: { readonly offset: number; readonly line: number; readonly column: number };
  readonly end: { readonly offset: number; readonly line: number; readonly column: number };
};

/** The span of `text` from the zero-based `from` to `to` columns of the zero-based line `line`. */
function spanAt(text: string, line: number, from: number, to: number): Span {
  const lineOffset = text
    .split('\n')
    .slice(0, line)
    .reduce((sum, previous) => sum + previous.length + 1, 0);
  return {
    start: { offset: lineOffset + from, line: line + 1, column: from + 1 },
    end: { offset: lineOffset + to, line: line + 1, column: to + 1 },
  };
}

/**
 * Interprets the fields on model `User` beside the composite types, and builds the diagnostics a
 * test expects there: each is reported at the `@default` attribute of the field it names.
 */
function scenario(fields: string, extraTypes = '') {
  const schema = `${types}${extraTypes}
model User {
  id Int @id
${fields}
}`;
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
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
  const lines = schema.split('\n');
  const modelLine = lines.indexOf('model User {');
  const defaultOf = (field: string): Span => {
    const line = lines.findIndex(
      (text, index) => index > modelLine && new RegExp(`^\\s+${field}\\s`).test(text),
    );
    const text = lines[line] ?? '';
    return spanAt(schema, line, text.indexOf('@default('), text.lastIndexOf(')') + 1);
  };
  const at = (code: string) => (field: string, message: string) => ({
    code,
    message,
    sourceId: 'schema.prisma',
    span: defaultOf(field),
  });
  return {
    schema,
    diagnostics: result.ok ? [] : result.failure.diagnostics,
    incompatible: at('PSL_VALUE_TYPE_INCOMPATIBLE'),
    invalidLiteral: at('PSL_INVALID_DEFAULT_LITERAL'),
  };
}

const amounts = (members: string) =>
  `{"price": "1.5", "cents": "1.50", "big": "1", "payload": {}, "role": "a"${members}}`;

describe('a default on a value-object field matches its composite type', () => {
  it('accepts values with every required member, an absent optional member, a list member and a nested value object', () => {
    expect(
      scenario(`  home  Address   @default(json\`{"street": "x", "tags": []}\`)
  homes Address[] @default([json\`{"street": "x", "zip": null, "tags": ["a"]}\`])
  outer Outer     @default(json\`{"inner": {"street": "x", "tags": []}, "count": 1}\`)`)
        .diagnostics,
    ).toEqual([]);
  });

  it('accepts nullable list elements in literal and JSON value-object defaults', () => {
    expect(
      scenario(
        `  homes Address?[] @default([null, json\`{"street":"x","tags":[]}\`, null])
  jsonHomes Address?[] @default(json\`[null,{"street":"x","tags":[]}]\`)
  nested NullableMembers @default(json\`{"texts":[null,"x"],"addresses":[null,{"street":"x","tags":[]}]}\`)`,
        `type NullableMembers {
  texts String?[]
  addresses Address?[]
}
`,
      ).diagnostics,
    ).toEqual([]);
  });

  it('checks non-null elements after restoring null positions in a list default', () => {
    const { diagnostics, incompatible } = scenario(
      '  homes Address?[] @default([null, json`{"tags":[]}`])',
    );
    expect(diagnostics).toEqual([
      incompatible(
        'homes',
        'Field "User.homes[1].street": the member is required, and the default has no value for it',
      ),
    ]);
  });

  it('refuses a JSON object or string as the default of a list of value objects', () => {
    const { diagnostics, incompatible } =
      scenario(`  homes Address[] @default(json\`{"street": "x", "tags": []}\`)
  names Address[] @default(json\`"x"\`)`);
    expect(diagnostics).toEqual([
      incompatible(
        'homes',
        'Field "User.homes": the default of a list of value objects is a JSON array, not a JSON object',
      ),
      incompatible(
        'names',
        'Field "User.names": the default of a list of value objects is a JSON array, not a JSON string',
      ),
    ]);
  });

  it('refuses a JSON array as the default of a single value object', () => {
    const { diagnostics, incompatible } = scenario('  home Address @default(json`[1]`)');
    expect(diagnostics).toEqual([
      incompatible(
        'home',
        'Field "User.home": the default of a value object is a JSON object, not a JSON array',
      ),
    ]);
  });

  it('refuses an element of a list default that is not a JSON object', () => {
    const { diagnostics, incompatible } = scenario('  homes Address[] @default([json`1`])');
    expect(diagnostics).toEqual([
      incompatible(
        'homes',
        'Field "User.homes[0]": a value of "Address" is a JSON object, not a JSON number',
      ),
    ]);
  });

  it('refuses a key that is not a member, and a required member with no value', () => {
    const { diagnostics, incompatible } = scenario(
      '  home Address @default(json`{"street": "x", "city": "y"}`)',
    );
    expect(diagnostics).toEqual([
      incompatible('home', 'Field "User.home": "city" is not a member of "Address"'),
      incompatible(
        'home',
        'Field "User.home.tags": the member is required, and the default has no value for it',
      ),
    ]);
  });

  it('accepts each member value in the stored form its codec reads: decimal and big integer strings, and any JSON value in a JSON member', () => {
    expect(
      scenario(`  a Amounts @default(json\`${amounts('')}\`)
  s Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": "x", "role": "b"}\`)
  n Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": 1, "role": "a"}\`)
  t Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": true, "role": "a"}\`)
  l Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": [1], "role": "a"}\`)
  z Amounts @default(json\`{"price": "1.5", "cents": "1.50", "big": "1", "payload": null, "role": "a"}\`)`)
        .diagnostics,
    ).toEqual([]);
  });

  it('refuses a member value its codec does not read, with the codec message', () => {
    const { diagnostics, invalidLiteral } = scenario(
      '  a Amounts @default(json`{"price": 1.5, "cents": 1.5, "big": 1, "payload": {}, "role": "a"}`)',
    );
    expect(diagnostics).toEqual([
      invalidLiteral('a', 'Field "User.a.price": value must be text'),
      invalidLiteral('a', 'Field "User.a.cents": value must be text'),
      invalidLiteral('a', 'Field "User.a.big": value must be text'),
    ]);
  });

  it('refuses an enum member value that is not a value of the enum', () => {
    const { diagnostics, invalidLiteral } = scenario(
      '  a Amounts @default(json`{"price": "1.5", "cents": "1.50", "big": "1", "payload": {}, "role": "Z"}`)',
    );
    expect(diagnostics).toEqual([
      invalidLiteral('a', 'Field "User.a.role": Expected one of: "a" | "b"'),
    ]);
  });

  it('accepts JSON null as the default of an optional value object or list of them, and refuses it on a required one', () => {
    const { diagnostics, incompatible } = scenario(`  a Address?   @default(json\`null\`)
  b Address[]? @default(json\`null\`)
  c Address    @default(json\`null\`)
  d Address[]  @default(json\`null\`)`);
    expect(diagnostics).toEqual([
      incompatible('c', 'Field "User.c": the default of a value object is a JSON object, not null'),
      incompatible(
        'd',
        'Field "User.d": the default of a list of value objects is a JSON array, not null',
      ),
    ]);
  });

  it('refuses null for a required member and a non-array for a list member', () => {
    const { diagnostics, incompatible } = scenario(
      '  home Address @default(json`{"street": null, "tags": "a"}`)',
    );
    expect(diagnostics).toEqual([
      incompatible(
        'home',
        'Field "User.home.street": the member is not optional, so its value is not null',
      ),
      incompatible(
        'home',
        'Field "User.home.tags": the member is a list, so its value is a JSON array, not a JSON string',
      ),
    ]);
  });

  it('reports a member whose type does not resolve where it is declared, and not again in a default that sets it', () => {
    const { schema, diagnostics } = scenario(
      '  x Broken @default(json`{"b": 1, "s": "x"}`)',
      'type Broken {\n  b Foo\n  s String\n}\n',
    );
    const memberLine = schema.split('\n').indexOf('  b Foo');
    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Foo"',
        sourceId: 'schema.prisma',
        data: { name: 'Foo', reference: 'type', constructorCall: false },
        span: spanAt(schema, memberLine, 4, 7),
      },
    ]);
  });

  it('checks a nested value object, each member value with its codec, and each list element', () => {
    const { diagnostics, incompatible, invalidLiteral } = scenario(
      '  outer Outer @default(json`{"inner": {"street": 1, "tags": [true, null], "zip": {}}, "count": "x"}`)',
    );
    expect(diagnostics).toEqual([
      invalidLiteral('outer', 'Field "User.outer.inner.street": value must be text'),
      invalidLiteral('outer', 'Field "User.outer.inner.zip": value must be text'),
      invalidLiteral('outer', 'Field "User.outer.inner.tags[0]": value must be text'),
      incompatible(
        'outer',
        'Field "User.outer.inner.tags[1]": an element of the member is not null',
      ),
      invalidLiteral('outer', 'Field "User.outer.count": value must be a whole number'),
    ]);
  });
});
