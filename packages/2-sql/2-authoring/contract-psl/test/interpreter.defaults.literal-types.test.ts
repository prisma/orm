import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
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

function interpret(schema: string, codecLookup = postgresCodecLookup) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: pgvectorAuthoringContributions,
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

describe('literal defaults the codec accepts', () => {
  it('reads every literal form in the outcome schema', () => {
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
      ratio: { kind: 'literal', value: Number.NaN },
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
    [
      'Infinity on a float column',
      'ratio Float @default(Infinity)',
      'ratio',
      Number.POSITIVE_INFINITY,
    ],
    ['a json null', 'meta Jsonb @default(json`null`)', 'meta', null],
  ])('reads %s', (_name, field, column, expected) => {
    expect(columnDefaults(model(`  ${field}`))[column]).toEqual({
      kind: 'literal',
      value: expected,
    });
  });

  it('emits a bigint default as the decimal text its codec encodes', () => {
    expect(columnDefaults(model('  balance BigInt @default(9007199254740993)'))['balance']).toEqual(
      {
        kind: 'literal',
        value: '9007199254740993',
      },
    );
  });
});

describe('literal defaults the codec refuses', () => {
  it.each([
    [
      'a bigint literal on an int column',
      'count Int @default(100000000000000099)',
      'N.count": pg/int4@1 is not compatible with an i64 literal; it accepts i8, i16, i32 literals',
    ],
    [
      'a decimal literal on an int column',
      'count Int @default(1.5)',
      'N.count": pg/int4@1 is not compatible with a decimal literal; it accepts i8, i16, i32 literals',
    ],
    [
      'a string literal on a jsonb column',
      'meta Jsonb @default("{}")',
      'N.meta": pg/jsonb@1 is not compatible with a string literal; it accepts json literals',
    ],
    [
      'a string literal on a decimal column',
      'price Decimal @default("1.50")',
      'N.price": pg/numeric@1 is not compatible with a string literal;',
    ],
    [
      'a string literal on an int column',
      'count Int @default("1")',
      'N.count": pg/int4@1 is not compatible with a string literal;',
    ],
    [
      'a json literal on an int column',
      'count Int @default(json`1`)',
      'N.count": pg/int4@1 is not compatible with a json literal;',
    ],
    [
      'a list literal on a column whose codec names no list',
      'count Int @default([1, 2])',
      'N.count": pg/int4@1 is not compatible with a list literal;',
    ],
    [
      'a string element in a list of ints',
      'scores Int[] @default([1, "x"])',
      'N.scores" at element 2: pg/int4@1 is not compatible with a string literal; it accepts i8, i16, i32 literals',
    ],
    [
      'a list literal on a jsonb column',
      'meta Jsonb @default([1, 2])',
      'N.meta": pg/jsonb@1 is not compatible with a list literal; it accepts json literals',
    ],
  ])('refuses %s as incompatible', (_name, field, message) => {
    expect(diagnostics(model(`  ${field}`))).toEqual([
      expect.objectContaining({
        code: 'PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE',
        message: expect.stringContaining(message),
        sourceId: 'schema.prisma',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
  });

  it('refuses a json body that is not a JSON document', () => {
    expect(diagnostics(model('  meta Jsonb @default(json`{ plan }`)'))).toEqual([
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

  it('refuses a non-finite literal on a codec that names no float', () => {
    expect(diagnostics(model('  count Int @default(NaN)'))).toEqual([
      expect.objectContaining({
        code: 'PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE',
        message: expect.stringContaining(
          'pg/int4@1 is not compatible with a float literal; it accepts i8, i16, i32 literals',
        ),
      }),
    ]);
  });

  it('refuses a number on a column whose codec names only string', () => {
    expect(diagnostics(model('  payload Bytes @default(1234)'))).toEqual([
      expect.objectContaining({
        code: 'PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE',
        message: expect.stringContaining(
          'pg/bytea@1 is not compatible with an i16 literal; it accepts string literals',
        ),
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
