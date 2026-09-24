import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  pgvectorAuthoringContributions,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
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
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: { ...pgvectorAuthoringContributions, dataTypes },
    dataTypeLookup: fixtureDataTypeSupport.lookup,
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
  it.each([
    [
      'a number too wide for the column',
      'count Int @default(100000000000000099)',
      'N.count": pg/int4 has no cast from pg/int8; it casts from pg/int2',
    ],
    [
      'a number with a fraction on a whole-number column',
      'count Int @default(1.5)',
      'N.count": pg/int4 has no cast from pg/numeric; it casts from pg/int2',
    ],
    [
      'a quoted document on a jsonb column',
      'meta Jsonb @default("{}")',
      'N.meta": pg/jsonb has no cast from pg/text; it casts from pg/json',
    ],
    [
      'quoted digits on a numeric column',
      'price Decimal @default("1.50")',
      'N.price": pg/numeric has no cast from pg/text;',
    ],
    [
      'quoted digits on an int column',
      'count Int @default("1")',
      'N.count": pg/int4 has no cast from pg/text;',
    ],
    [
      'a JSON document on an int column',
      `count Int @default(${tagged('json', '1')})`,
      'N.count": pg/int4 has no cast from pg/json;',
    ],
    [
      'a written list on a column that holds one value',
      'count Int @default([1, 2])',
      'N.count": pg/int4 has no cast from a list;',
    ],
    [
      'text among a list of numbers',
      'scores Int[] @default([1, "x"])',
      'N.scores" at element 2: pg/int4 has no cast from pg/text; it casts from pg/int2',
    ],
    [
      'a written list on a jsonb column',
      'meta Jsonb @default([1, 2])',
      'N.meta": pg/jsonb has no cast from a list; it casts from pg/json',
    ],
    [
      'a non-finite word on a whole-number column',
      'count Int @default(NaN)',
      'N.count": pg/int4 has no cast from pg/numeric; it casts from pg/int2',
    ],
    [
      'a single value on a list column',
      `docs Jsonb[] @default(${tagged('json', '{}')})`,
      'N.docs": this column holds a list, so its default is a list literal',
    ],
    [
      'a number on a column whose type takes only text',
      'payload Bytes @default(1234)',
      'N.payload": pg/bytea has no cast from pg/int2; it casts from pg/text',
    ],
  ])('refuses %s', (_name, field, message) => {
    expect(diagnostics(model(`  ${field}`))).toEqual([
      expect.objectContaining({
        code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE',
        message: expect.stringContaining(message),
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
        code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE',
        message: expect.stringContaining('this target has no data type for a boolean value'),
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
        code: 'PSL_INVALID_JSON_LITERAL',
        message: expect.stringContaining('N.meta'),
      }),
    ]);
  });

  it('refuses a vector whose length does not match the column, with the codec message', () => {
    expect(diagnostics(model('  embed pgvector.Vector(3) @default([1, 2])'))).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: expect.stringContaining('Vector length mismatch: expected 3, got 2'),
      }),
    ]);
  });

  it('refuses a tag no pack registered, listing the tags the stack knows', () => {
    expect(diagnostics(model(`  meta Jsonb @default(${tagged('sqlite.sql', 'x')})`))).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
        message: expect.stringContaining('Unknown literal tag "sqlite.sql"'),
      }),
    ]);
  });
});

describe('the codec lookup the column was resolved from', () => {
  it('raises an internal error when it exposes no descriptorFor', () => {
    const { descriptorFor: _descriptorFor, ...withoutDescriptors } = postgresCodecLookup;
    expect(() => interpret(model('  count Int @default(1)'), withoutDescriptors)).toThrow(
      'exposes no descriptorFor',
    );
  });

  it('raises an internal error when the column codec has no descriptor', () => {
    expect(() =>
      interpret(model('  count Int @default(1)'), {
        ...postgresCodecLookup,
        descriptorFor: () => undefined,
      }),
    ).toThrow('no codec descriptor is registered for "pg/int4@1"');
  });
});
