import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  pgvectorAuthoringContributions,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

/** The backtick fencing a tagged literal, as an escape so no quoted string in this file holds one. */
const BACKTICK = '\u0060';

/** A tagged literal as it is written in PSL: the tag plus its fenced body. */
const tagged = (tag: string, body: string): string => `${tag}${BACKTICK}${body}${BACKTICK}`;

function interpret(
  schema: string,
  codecLookup = postgresCodecLookup,
  dataTypes = fixtureDataTypeSupport.entries,
) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: pgvectorAuthoringContributions,
    dataTypes: { entries: dataTypes, lookup: fixtureDataTypeSupport.lookup },
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    codecLookup,
  });
}

function columnDefaults(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const table = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['N'];
  return Object.fromEntries(
    Object.entries(table?.columns ?? {}).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.failure.diagnostics;
}

const model = (fields: string) => `model N {\n  id Int @id\n${fields}\n}\n`;

describe('written defaults a column takes', () => {
  it('reads every written form in the outcome schema', () => {
    expect(
      columnDefaults(
        model(`  name     String   @default("anonymous")
  small    SmallInt @default(100)
  count    Int      @default(100000)
  balance  BigInt   @default(100000000000000099)
  price    Decimal  @default(1.50)
  ratio    Float    @default(NaN)
  active   Boolean  @default(true)
  meta     Jsonb    @default(json\`{ "plan": "free", "seats": 1 }\`)
  scores   Int[]    @default([1, 2])
  docs     Jsonb[]  @default([json\`{}\`, json\`[]\`])
  embed    pgvector.Vector(3) @default([0.1, 0.2, 0.3])
  expires  DateTime @default(sql\`now() + interval '3 days'\`)`),
      ),
    ).toEqual({
      name: { kind: 'literal', value: 'anonymous' },
      small: { kind: 'literal', value: 100 },
      count: { kind: 'literal', value: 100000 },
      balance: { kind: 'literal', value: '100000000000000099' },
      price: { kind: 'literal', value: '1.50' },
      ratio: { kind: 'literal', value: 'NaN' },
      active: { kind: 'literal', value: true },
      meta: { kind: 'literal', value: { plan: 'free', seats: 1 } },
      scores: { kind: 'literal', value: [1, 2] },
      docs: { kind: 'literal', value: [{}, []] },
      embed: { kind: 'literal', value: [0.1, 0.2, 0.3] },
      expires: { kind: 'function', expression: "now() + interval '3 days'" },
    });
  });

  it.each([
    ['a whole number on a float column', 'ratio Float @default(1)', 'ratio', 1],
    ['a whole number on a decimal column', 'price Decimal @default(42)', 'price', '42'],
    ['a whole number on a bigint column', 'balance BigInt @default(42)', 'balance', '42'],
    ['a decimal keeping its trailing zeros', 'price Decimal @default(1.50)', 'price', '1.50'],
    ['leading zeros dropped', 'price Decimal @default(007.50)', 'price', '7.50'],
    ['the sign of zero dropped', 'price Decimal @default(-0.0)', 'price', '0.0'],
    ['Infinity on a float column', 'ratio Float @default(Infinity)', 'ratio', 'Infinity'],
    ['a json null', `meta Jsonb @default(${tagged('json', 'null')})`, 'meta', null],
  ])('reads %s', (_name, field, column, expected) => {
    expect(columnDefaults(model(`  ${field}`))[column]).toEqual({
      kind: 'literal',
      value: expected,
    });
  });

  it('stores a whole number past a double as the digit text its type holds', () => {
    expect(columnDefaults(model('  balance BigInt @default(9007199254740993)'))['balance']).toEqual(
      {
        kind: 'literal',
        value: '9007199254740993',
      },
    );
  });
});

describe('written defaults a column refuses', () => {
  const NO_DOUBLE_HOLDS = '9'.repeat(400);

  it.each([
    [
      'a number too wide for the column',
      'count Int @default(100000000000000099)',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from pg/int8; write a number',
    ],
    [
      'a number with a fraction on a whole-number column',
      'count Int @default(1.5)',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from pg/numeric; write a number',
    ],
    [
      'a quoted document on a jsonb column',
      'meta Jsonb @default("{}")',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.meta": pg/jsonb has no cast from pg/text; write json`...`',
    ],
    [
      'quoted digits on a numeric column',
      'price Decimal @default("1.50")',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.price": pg/numeric has no cast from pg/text; write a number',
    ],
    [
      'quoted digits on an int column',
      'count Int @default("1")',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from pg/text; write a number',
    ],
    [
      'a JSON document on an int column',
      `count Int @default(${tagged('json', '1')})`,
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from pg/json; write a number',
    ],
    [
      'a written list on a column that holds one value',
      'count Int @default([1, 2])',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from a list; write a number',
    ],
    [
      'text among a list of numbers',
      'scores Int[] @default([1, "x"])',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.scores" at element 2: pg/int4 has no cast from pg/text; write a number',
    ],
    [
      'a written list on a jsonb column',
      'meta Jsonb @default([1, 2])',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.meta": pg/jsonb has no cast from a list; write json`...`',
    ],
    [
      'a non-finite word on a whole-number column',
      'count Int @default(NaN)',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.count": pg/int4 has no cast from pg/numeric; write a number',
    ],
    [
      'a number on a column whose type takes only text',
      'payload Bytes @default(1234)',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'Field "N.payload": pg/bytea has no cast from pg/int2; write a quoted string',
    ],
    [
      'a single value on a list column',
      `docs Jsonb[] @default(${tagged('json', '{}')})`,
      'PSL_DEFAULT_LIST_EXPECTED',
      'Field "N.docs": this column holds a list, so its default is a list literal, as in [1, 2]',
    ],
    [
      'a number whose cast to the column type throws',
      `ratio Float @default(${NO_DOUBLE_HOLDS})`,
      'PSL_INVALID_LITERAL',
      `Field "N.ratio": ${NO_DOUBLE_HOLDS} is out of range.`,
    ],
    [
      'a written list whose list cast throws',
      `embed pgvector.Vector(3) @default([1, 2, ${NO_DOUBLE_HOLDS}])`,
      'PSL_INVALID_LITERAL',
      `Field "N.embed": ${NO_DOUBLE_HOLDS} is out of range.`,
    ],
  ])('refuses %s', (_name, field, code, message) => {
    expect(diagnostics(model(`  ${field}`))).toEqual([
      expect.objectContaining({
        code,
        message,
        sourceId: 'schema.prisma',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
  });

  it('refuses a plain form this target has no data type for, as SQLite has none for a boolean', () => {
    const entries = Object.fromEntries(
      Object.entries(fixtureDataTypeSupport.entries).filter(([key]) => key !== 'pg/bool'),
    );
    const result = interpret(
      model('  active Boolean @default(true)'),
      postgresCodecLookup,
      entries,
    );
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message:
          'Field "N.active": This target has no data type for a boolean value; write sql`...`',
      }),
    ]);
  });

  it('keeps a raw SQL default on a list column', () => {
    const field = `  scores Int[] @default(${tagged('sql', 'ARRAY[1, 2]')})`;
    expect(columnDefaults(model(field))['scores']).toEqual({
      kind: 'function',
      expression: 'ARRAY[1, 2]',
    });
  });

  it('refuses a json body that is not a JSON document', () => {
    expect(diagnostics(model(`  meta Jsonb @default(${tagged('json', '{ plan }')})`))).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_LITERAL',
        message:
          'Field "N.meta": Expected property name or \'}\' in JSON at position 2 (line 1 column 3)',
      }),
    ]);
  });

  it('refuses a vector whose length does not match the column, with the codec message', () => {
    expect(diagnostics(model('  embed pgvector.Vector(3) @default([1, 2])'))).toEqual([
      {
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: 'Field "N.embed": Vector length mismatch: expected 3, got 2',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 50, line: 3, column: 28 },
          end: { offset: 66, line: 3, column: 44 },
        },
      },
    ]);
  });

  it('refuses an element the list cast does not take at the element, suggesting the forms of the types it takes', () => {
    expect(diagnostics(model('  embed pgvector.Vector(3) @default([1, "x", 3])'))).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message:
          'Field "N.embed" at element 2: pgvector/vector has no cast from a list holding pg/text; write a number',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 63, line: 3, column: 41 },
          end: { offset: 66, line: 3, column: 44 },
        },
      },
    ]);
  });

  it('refuses an unknown tag among the elements of a list read through a list cast, at the element', () => {
    expect(
      diagnostics(model(`  embed pgvector.Vector(3) @default([1, ${tagged('pg.json', '2')}, 3])`)),
    ).toEqual([
      {
        code: 'PSL_UNKNOWN_LITERAL_TAG',
        message:
          'Field "N.embed" at element 2: Unknown literal tag "pg.json". Known tags: sql, json.',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 63, line: 3, column: 41 },
          end: { offset: 73, line: 3, column: 51 },
        },
      },
    ]);
  });

  it('refuses a tag no pack registered, listing the tags the stack knows', () => {
    expect(diagnostics(model(`  meta Jsonb @default(${tagged('sqlite.sql', 'x')})`))).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_LITERAL_TAG',
        message: 'Field "N.meta": Unknown literal tag "sqlite.sql". Known tags: sql, json.',
      }),
    ]);
  });
});

describe('the codec lookup the column was resolved from', () => {
  it('raises an internal error when the column codec has no descriptor', () => {
    expect(() =>
      interpret(model('  count Int @default(1)'), {
        ...postgresCodecLookup,
        descriptorFor: () => undefined,
      }),
    ).toThrow('no codec descriptor is registered for "pg/int4@1"');
  });

  it('passes a codec internal error through instead of reporting the default as refused', () => {
    const intDescriptor = postgresCodecLookup.descriptorFor('pg/int4@1');
    if (intDescriptor === undefined) throw new Error('the fixture lookup has pg/int4@1');
    const brokenLookup = {
      ...postgresCodecLookup,
      descriptorFor: (id: string) =>
        id === 'pg/int4@1'
          ? {
              ...intDescriptor,
              factory: () => () => ({
                ...intDescriptor.factory(undefined)({ name: id }),
                decodeJson: () => {
                  throw new InternalError('a codec broke an invariant');
                },
              }),
            }
          : postgresCodecLookup.descriptorFor(id),
    };
    expect(() => interpret(model('  count Int @default(1)'), brokenLookup)).toThrow(InternalError);
  });
});
