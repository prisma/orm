import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresEnumInferenceCodecs,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    authoringContributions: {
      entityTypes: testEnumEntityContributions,
      type: {},
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
      dataTypes: fixtureDataTypeSupport.entries,
    },
    ...fixtureInterpreterTypes,
    createNamespace: createTestSqlNamespace,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
    capabilities: { sql: { scalarList: true } },
  });
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

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
  const result = interpret(schema);
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

  it('reads a member written with a plus sign as the number without it', () => {
    expect(storedValues('pg/int8@1', ['Low = +2', 'High = +9007199254740993'])).toEqual(
      storedValues('pg/int8@1', ['Low = 2', 'High = 9007199254740993']),
    );
    expect(storedValues('pg/numeric@1', ['Rate = +1.50'])).toEqual(
      storedValues('pg/numeric@1', ['Rate = 1.50']),
    );
  });

  it('stores every digit of a pg/numeric@1 member', () => {
    expect(storedValues('pg/numeric@1', ['A = 0.12345678901234567890'])).toEqual({
      values: ['0.12345678901234567890'],
    });
  });

  it.each([['pg/json@1'], ['pg/jsonb@1']])(
    'refuses a %s member written as a number, which no cast admits',
    (codecId) => {
      expect(storedValues(codecId, ['Low = 1']).diagnostics).toEqual([
        {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: expect.stringContaining('enum "Key" member "Low"'),
        },
      ]);
    },
  );

  it('reports why the number is refused when the codec refuses it too', () => {
    expect(storedValues('pg/text@1', ['Low = 1']).diagnostics).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'enum "Key" member "Low": Expected a quoted string',
      },
    ]);
  });
});

describe('enum members written as string literals take the cast rule', () => {
  it('accepts a pg/text@1 member written as a string', () => {
    expect(storedValues('pg/text@1', ['Half = "0.5"'])).toEqual({ values: ['0.5'] });
  });

  it('accepts a pg/numeric@1 member written as a number', () => {
    expect(storedValues('pg/numeric@1', ['Half = 0.5', 'Whole = 1.50'])).toEqual({
      values: ['0.5', '1.50'],
    });
  });

  it.each([
    ['pg/numeric@1', '"0.5"'],
    ['pg/int8@1', '"9007199254740993"'],
    ['pg/json@1', '"low"'],
    ['pg/jsonb@1', '"low"'],
  ])('refuses a %s member written as the string %s, which no cast admits', (codecId, written) => {
    expect(storedValues(codecId, [`A = ${written}`]).diagnostics).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: expect.stringContaining('enum "Key" member "A"'),
      },
    ]);
  });

  it('says to write a pg/numeric@1 member as a number', () => {
    expect(storedValues('pg/numeric@1', ['Half = "0.5"']).diagnostics).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'enum "Key" member "Half": Expected a number; write 0.5',
      },
    ]);
  });

  it('words a refused member as it words the same value refused as a default', () => {
    const [member, fieldDefault] = diagnosticsOf(`
enum Key {
  @@type("pg/numeric@1")
  Half = "0.5"
}

model Post {
  id    Int     @id
  price Decimal @default("0.5")
}
`);
    expect({ member, fieldDefault }).toEqual({
      member: {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'enum "Key" member "Half": Expected a number; write 0.5',
      },
      fieldDefault: {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'Field "Post.price": Expected a number; write 0.5',
      },
    });
  });
});

describe('enum members written as lists', () => {
  it('refuses a list member when the codec data type has no list cast', () => {
    expect(storedValues('pg/text@1', ['A = ["a", "b"]']).diagnostics).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'enum "Key" member "A": Expected a quoted string; got a list',
      },
    ]);
  });
});

describe('enum members the codec refuses', () => {
  it('reports a member the codec refuses as PSL_VALUE_REFUSED, with the codec message', () => {
    expect(storedValues('test/positive-int4@1', ['Up = 1', 'Down = -1']).diagnostics).toEqual([
      {
        code: 'PSL_VALUE_REFUSED',
        message: 'enum "Key" member "Down": value must be positive',
      },
    ]);
  });
});
