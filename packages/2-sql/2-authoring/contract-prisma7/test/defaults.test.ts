import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import {
  fixturesDir,
  loadFixtureTable,
  postgresSourceContext,
  postgresSourceContextWithout,
} from './support';

describe('DateTime string defaults', () => {
  it('carry the default Postgres stores for each native type, not the text Prisma 7 writes', async () => {
    const { columns } = await loadFixtureTable('datetime-defaults', 'Scalars');
    const expressionOf = (column: string) => columns[column]?.['default'];
    expect({
      tsPlus: expressionOf('tsPlus'),
      tzPlus: expressionOf('tzPlus'),
      dMinus: expressionOf('dMinus'),
      tMs: expressionOf('tMs'),
      ttzPlus: expressionOf('ttzPlus'),
    }).toEqual({
      tsPlus: { kind: 'function', expression: "'2024-01-02 03:04:05'" },
      tzPlus: { kind: 'function', expression: "'2024-01-02 01:04:05+00'" },
      dMinus: { kind: 'function', expression: "'2024-01-02'" },
      tMs: { kind: 'function', expression: "'12:34:56.789'" },
      ttzPlus: { kind: 'function', expression: "'03:04:05+02'" },
    });
  });
});

describe('Bytes[] and DateTime[] list defaults', () => {
  it('carry an ARRAY literal of the elements Postgres stores, cast to the column type', async () => {
    const { columns } = await loadFixtureTable('list-defaults', 'Lists');
    expect(
      Object.fromEntries(
        ['bl', 'blEmpty', 'dl', 'dlEmpty', 'tzl', 'datel', 'timel', 'timetzl', 'ts6l'].map(
          (column) => [column, columns[column]?.['default']],
        ),
      ),
    ).toEqual({
      bl: { kind: 'function', expression: "ARRAY['\\x68656c6c6f', '\\x776f726c64']::BYTEA[]" },
      blEmpty: { kind: 'function', expression: 'ARRAY[]::BYTEA[]' },
      dl: {
        kind: 'function',
        expression: "ARRAY['2024-01-01 00:00:00', '2024-01-02 03:04:05.123']::TIMESTAMP(3)[]",
      },
      dlEmpty: { kind: 'function', expression: 'ARRAY[]::TIMESTAMP(3)[]' },
      tzl: { kind: 'function', expression: "ARRAY['2024-01-02 03:04:05+00']::TIMESTAMPTZ(6)[]" },
      datel: { kind: 'function', expression: "ARRAY['2024-01-02']::DATE[]" },
      timel: { kind: 'function', expression: "ARRAY['12:34:56']::TIME(6)[]" },
      timetzl: { kind: 'function', expression: "ARRAY['12:34:56+00']::TIMETZ(6)[]" },
      ts6l: {
        kind: 'function',
        expression: "ARRAY['2024-01-02 03:04:05.123456']::TIMESTAMP(6)[]",
      },
    });
  });
});

describe('dbgenerated("<sql>")', () => {
  it('lowers to a raw SQL default without a registry entry for dbgenerated', async () => {
    const { columns } = await loadFixtureTable(
      'defaults',
      'Defaults',
      'public',
      postgresSourceContextWithout('dbgenerated'),
    );
    expect(columns['generated']?.['default']).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('is refused unless the argument list is a single positional string with text in it', async () => {
    expect(await diagnosticsOf('dbgenerated-without-expression', 'unread-argument.prisma')).toEqual(
      [
        'Field "T.number": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.two": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.named": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.blank": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.spaces": @default function "dbgenerated()" has an argument this contract source does not read.',
      ],
    );
  });
});

describe('dbgenerated() with no expression', () => {
  it('describes a required column with no default and reports nothing', async () => {
    const { columns } = await loadFixtureTable('dbgenerated-without-expression', 'T');
    expect(columns['a']).toEqual({ nativeType: 'text', codecId: 'pg/text@1', nullable: false });
  });

  it('describes an optional or list column with no default, as Prisma 7 creates it', async () => {
    const { columns } = await loadFixtureTable('dbgenerated-without-expression-optional', 'T');
    expect({ a: columns['a'], list: columns['list'] }).toEqual({
      a: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      list: {
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: true,
        many: true,
        noCheck: ['elementNotNull'],
      },
    });
  });
});

describe('Decimal and BigInt number defaults', () => {
  it('keep the number exactly as written, as decimal text', async () => {
    const { columns } = await loadFixtureTable('number-defaults', 'Decimals');
    expect(
      Object.fromEntries(
        [
          'long',
          'tiny',
          'negative',
          'whole',
          'zerosBare',
          'zerosScaled',
          'zerosDefault',
          'list',
          'bigLong',
          'bigList',
        ].map((column) => [column, columns[column]?.['default']]),
      ),
    ).toEqual({
      long: { kind: 'literal', value: '12345678901234567890.123456789' },
      tiny: { kind: 'literal', value: '0.000000000000000001' },
      negative: { kind: 'literal', value: '-1.5' },
      whole: { kind: 'literal', value: '42' },
      zerosBare: { kind: 'literal', value: '1.50' },
      zerosScaled: { kind: 'literal', value: '1.50' },
      zerosDefault: { kind: 'literal', value: '1.50' },
      list: { kind: 'literal', value: ['1.50', '-2', '0.000000000000000001'] },
      bigLong: { kind: 'literal', value: '9007199254740993' },
      bigList: { kind: 'literal', value: ['9007199254740993', '-1'] },
    });
  });

  it('drop leading zeros and the sign of zero and keep trailing zeros, as Prisma 7 writes the SQL default', async () => {
    const { columns } = await loadFixtureTable('number-default-spellings', 'Spellings');
    expect(
      Object.fromEntries(
        Object.entries(columns).flatMap(([name, column]) =>
          column['default'] === undefined ? [] : [[name, column['default']]],
        ),
      ),
    ).toEqual({
      leadingZeros: { kind: 'literal', value: '7' },
      negativeZero: { kind: 'literal', value: '0' },
      leadingZeroFraction: { kind: 'literal', value: '0.10' },
      bareLeadingZeros: { kind: 'literal', value: '7' },
      bareNegativeZero: { kind: 'literal', value: '0' },
      bareLeadingZeroFraction: { kind: 'literal', value: '0.10' },
      long: { kind: 'literal', value: '12345678901234567890.123456789' },
      tiny: { kind: 'literal', value: '0.000000000000000001' },
      zerosBare: { kind: 'literal', value: '1.50' },
      zerosScaled: { kind: 'literal', value: '1.50' },
      bigLong: { kind: 'literal', value: '9007199254740993' },
      bigNegativeZero: { kind: 'literal', value: '0' },
      bigLeadingZeros: { kind: 'literal', value: '7' },
      mixed: {
        kind: 'literal',
        value: ['7', '0', '0.10', '12345678901234567890.123456789', '0.000000000000000001', '1.50'],
      },
      bigMixed: { kind: 'literal', value: ['9007199254740993', '0', '7'] },
    });
  });
});

async function diagnosticsOf(caseName: string, file: string) {
  const schemaPath = join(fixturesDir, caseName, file);
  const result = await prisma7Contract(schemaPath, {
    binding: prisma7PostgresBinding,
  }).source.load(postgresSourceContext([schemaPath]));
  return result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.message);
}

describe('Number defaults on String, Bytes, DateTime and Boolean fields', () => {
  it('are refused, naming the data type and the casts the column type has', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'other-types.prisma')).toEqual([
      'Field "OtherTypes.name": @default holds a pg/int2 value, which pg/text has no cast from; it casts from nothing.',
      'Field "OtherTypes.payload": @default holds a pg/int2 value, which pg/bytea has no cast from; it casts from pg/text.',
      'Field "OtherTypes.at": @default holds a pg/int2 value, which pg/timestamp has no cast from; it casts from pg/text.',
      'Field "OtherTypes.flag": @default holds a pg/int2 value, which pg/bool has no cast from; it casts from nothing.',
    ]);
  });
});

describe('Number defaults too large for the column', () => {
  it('are refused before anything is decoded, naming the data type', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'out-of-range.prisma')).toEqual([
      'Field "OutOfRange.count": @default holds a pg/int8 value, which pg/int4 has no cast from; it casts from pg/int2.',
      'Field "OutOfRange.small": @default holds a pg/int4 value, which pg/int2 has no cast from; it casts from nothing.',
      'Field "OutOfRange.ints": @default holds a pg/int8 value at element 2, which pg/int4 has no cast from; it casts from pg/int2.',
    ]);
  });
});

describe('Json defaults whose text is not a JSON document', () => {
  it('are rejected, carrying the JSON parser message', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'unreadable-json.prisma')).toEqual([
      expect.stringMatching(
        /^Field "UnreadableJson\.broken": @default holds text that this contract source does not read: /,
      ),
      expect.stringMatching(
        /^Field "UnreadableJson\.list": @default holds text at element 2 that this contract source does not read: /,
      ),
    ]);
  });
});

describe('Json, Decimal, BigInt and Float literal defaults', () => {
  it('lower through the column codec', async () => {
    const { columns } = await loadFixtureTable('defaults', 'Defaults');
    expect(
      Object.fromEntries(
        ['jsonLiteral', 'decimalLiteral', 'bigIntLiteral', 'floatLiteral', 'intLiteral'].map(
          (column) => [column, columns[column]?.['default']],
        ),
      ),
    ).toEqual({
      jsonLiteral: { kind: 'literal', value: { a: 1 } },
      decimalLiteral: { kind: 'literal', value: '12.34' },
      bigIntLiteral: { kind: 'literal', value: '9007199254740993' },
      floatLiteral: { kind: 'literal', value: 1.5 },
      intLiteral: { kind: 'literal', value: 42 },
    });
  });
});
