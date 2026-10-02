import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureTypeLookups } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresEnumInferenceCodecs,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

/** The values an enum typed by `codecId` stores for `members`, or the diagnostics that refuse it. */
function storedValues(codecId: string, members: readonly string[]) {
  const schema = `
enum Key {
  @@type("${codecId}")
${members.map((line) => `  ${line}`).join('\n')}
}

model Post {
  id  Int @id
  key Key
}
`;
  const result = interpretPslDocumentToSqlContract({
    ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    authoringContributions: {
      entityTypes: testEnumEntityContributions,
      field: {},
      type: {},
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
      dataTypes: fixtureDataTypeSupport.entries,
    },
    ...fixtureTypeLookups,
    createNamespace: createTestSqlNamespace,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
    capabilities: { sql: { scalarList: true } },
  });
  if (!result.ok) {
    return {
      diagnostics: result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    };
  }
  const storage = result.value.storage as unknown as SqlStorage;
  return {
    values:
      storage.namespaces[postgresTarget.defaultNamespaceId]?.entries.valueSet?.['Key']?.values,
  };
}

describe('enum members written as number literals', () => {
  it('stores a pg/int8@1 member past 2^53 with every digit, so the integer below it is not a duplicate', () => {
    expect(storedValues('pg/int8@1', ['A = 9007199254740993', 'B = 9007199254740992'])).toEqual({
      values: ['9007199254740993', '9007199254740992'],
    });
  });

  it('stores every digit of a pg/numeric@1 member', () => {
    expect(storedValues('pg/numeric@1', ['A = 0.12345678901234567890'])).toEqual({
      values: ['0.12345678901234567890'],
    });
  });

  it.each([['pg/json@1'], ['pg/jsonb@1']])(
    'reads a %s member that no cast admits with the codec, storing the number',
    (codecId) => {
      expect(storedValues(codecId, ['Low = 1', 'Half = 1.5'])).toEqual({ values: [1, 1.5] });
    },
  );

  it('reports why the number is refused when the codec refuses it too', () => {
    expect(storedValues('pg/text@1', ['Low = 1']).diagnostics).toContainEqual({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: 'enum "Key" member "Low": pg/text has no cast from pg/int2; it casts from nothing',
    });
  });
});

describe('enum members written as string literals are read by the codec', () => {
  it.each([
    ['pg/int8@1', '"9007199254740993"', '9007199254740993'],
    ['pg/numeric@1', '"1.50"', '1.50'],
    ['pg/json@1', '"low"', 'low'],
    ['pg/jsonb@1', '"low"', 'low'],
  ])('accepts a %s member written as %s', (codecId, written, stored) => {
    expect(storedValues(codecId, [`A = ${written}`])).toEqual({ values: [stored] });
  });
});
