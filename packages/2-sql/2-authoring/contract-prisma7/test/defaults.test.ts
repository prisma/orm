import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { fixturesDir, loadFixtureTable, postgresSourceContext } from './support';

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

describe('dbgenerated() with no expression', () => {
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

describe('Number defaults on String, Bytes, DateTime and Boolean fields', () => {
  it('are rejected, as Prisma 7 rejects them', async () => {
    const schemaPath = join(fixturesDir, 'number-default-spellings', 'other-types.prisma');
    const result = await prisma7Contract(schemaPath, {
      binding: prisma7PostgresBinding,
    }).source.load(postgresSourceContext([schemaPath]));
    expect(
      result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.message),
    ).toEqual([
      'Field "OtherTypes.name": @default holds 5, which is not a valid String value.',
      'Field "OtherTypes.payload": @default holds 1234, which is not a valid Bytes value.',
      'Field "OtherTypes.at": @default holds 0, which is not a valid DateTime value.',
      'Field "OtherTypes.flag": @default holds 1, which is not a valid Boolean value.',
    ]);
  });
});
