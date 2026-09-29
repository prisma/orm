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
} from './fixtures';

const types = `type Address {
  street String
  zip    String?
  tags   String[]
}

type Outer {
  inner Address
  count Int
}
`;

function diagnosticsOf(fields: string) {
  const result = interpretPslDocumentToSqlContract({
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      dataTypes: fixtureDataTypeSupport.entries,
      valueObjectStorageType: 'Jsonb',
    },
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
    ...symbolTableInputFromParseArgs({
      schema: `${types}
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

  it('checks a nested value object and each member value against the member type', () => {
    expect(
      diagnosticsOf(
        '  outer Outer @default(json`{"inner": {"street": 1, "tags": [true], "zip": {}}, "count": "x"}`)',
      ),
    ).toEqual([
      incompatible(
        'Field "User.outer.inner.street": pg/text has no cast from pg/int2; it casts from nothing',
      ),
      incompatible('Field "User.outer.inner.zip": its type pg/text does not store a JSON object'),
      incompatible(
        'Field "User.outer.inner.tags[0]": pg/text has no cast from pg/bool; it casts from nothing',
      ),
      incompatible(
        'Field "User.outer.count": pg/int4 has no cast from pg/text; it casts from pg/int2',
      ),
    ]);
  });
});
