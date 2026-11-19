import { renderSqlTypeName, resolveReportedSqlType } from '@internal/sql-contract/data-type';
import { CastExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { mysqlIntDescriptor } from '../src/core/codecs';
import {
  mysqlBigint,
  mysqlDataTypes,
  mysqlDecimal,
  mysqlDecimalParams,
  mysqlDecimalText,
  mysqlInt,
  mysqlText,
} from '../src/core/data-types';
import { mysqlDecimalDescriptor } from '../src/core/decimal-codec';

const column = { table: 'Price', name: 'amount' };
const instance = { name: 'test' };
const decimal = (params = {}) => mysqlDecimalDescriptor.factory(params)(instance);
const reported = (text: string) => ({ text, kind: undefined, schema: undefined, name: undefined });

describe('mysql/decimal', () => {
  it.each([
    [{ precision: 65, scale: 30 }, 'decimal(65,30)'],
    [{ precision: 10, scale: 2 }, 'decimal(10,2)'],
    [{ precision: 10 }, 'decimal(10)'],
    [{}, 'decimal'],
  ])('writes a column of %j as %s', (params, text) => {
    expect(renderSqlTypeName(mysqlDecimal, params)).toBe(text);
  });

  it('reads the type MySQL and MariaDB report, and a bare decimal as decimal(10,0)', () => {
    const resolved = resolveReportedSqlType(reported('decimal(10,2)'), mysqlDataTypes);
    expect({ id: resolved?.dataType.id, typeParams: resolved?.typeParams }).toEqual({
      id: 'mysql/decimal',
      typeParams: { precision: 10, scale: 2 },
    });
    expect([mysqlDecimal.sql.normalize({}), mysqlDecimal.sql.normalize({ precision: 7 })]).toEqual([
      { precision: 10, scale: 0 },
      { precision: 7, scale: 0 },
    ]);
  });

  it.each([
    [{ precision: 66, scale: 0 }],
    [{ precision: 40, scale: 31 }],
    [{ precision: 5, scale: 6 }],
    [{ scale: 2 }],
  ])('refuses the column type parameters %j', (params) => {
    expect(mysqlDecimalParams(params)).toBeInstanceOf(type.errors);
  });

  it('stores a value as the server prints it in the column: padded to its scale, without leading zeros or a minus sign on zero', () => {
    const params = { precision: 10, scale: 2 };
    expect([
      mysqlDecimal.valueFrom('1.5', params).value,
      mysqlDecimal.valueFrom('007', params).value,
      mysqlDecimal.valueFrom('-0.0', params).value,
      mysqlDecimal.valueFrom('12.50', {}).value,
    ]).toEqual(['1.50', '7.00', '0.00', '12.50']);
  });

  it('refuses a value the column would round or cannot hold', () => {
    const params = { precision: 5, scale: 2 };
    expect(() => mysqlDecimal.valueFrom('1.005', params)).toThrow(
      'mysql/decimal JSON value must be a number a decimal(5,2) column holds without rounding, with at most 3 digits before the point and 2 after it. 1.005 has 3 after it: round it to 2',
    );
    expect(() => mysqlDecimal.valueFrom('1000', params)).toThrow(
      'mysql/decimal JSON value must be a number a decimal(5,2) column holds without rounding, with at most 3 digits before the point and 2 after it. 1000 has 4 before it: keep it below 10^3, or widen the column',
    );
    expect(() => mysqlDecimal.valueFrom('1e5', params)).toThrow(/decimal text/);
  });

  it('holds 1.5 and 1.50 equal', () => {
    expect(mysqlDecimal.equalityKey?.('1.5')).toBe(mysqlDecimal.equalityKey?.('1.50'));
  });

  it('takes a default written as text, as an int and as a bigint', () => {
    expect({
      text: mysqlDecimal.casts[mysqlText.id]?.('012.50'),
      int: mysqlDecimal.casts[mysqlInt.id]?.(-42),
      bigint: mysqlDecimal.casts[mysqlBigint.id]?.('9223372036854775807'),
    }).toEqual({ text: '12.50', int: '-42', bigint: '9223372036854775807' });
    expect(() => mysqlDecimalText('twelve')).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});

describe('mysql/decimal@1', () => {
  it('compares, orders and sums: with every parameter cast, both servers compare a decimal exactly', () => {
    expect({
      dataType: mysqlDecimalDescriptor.dataType,
      traits: mysqlDecimalDescriptor.traits,
      keepsWrittenForm: mysqlDecimalDescriptor.keepsWrittenForm,
    }).toEqual({
      dataType: 'mysql/decimal',
      traits: ['equality', 'order', 'numeric'],
      keepsWrittenForm: true,
    });
  });

  it.each([
    [{ precision: 65, scale: 30 }, 'DECIMAL(65,30)'],
    [{ precision: 10, scale: 2 }, 'DECIMAL(65,30)'],
    [{ precision: 35, scale: 0 }, 'DECIMAL(65,30)'],
    [undefined, 'DECIMAL(65,30)'],
    [{ precision: 40 }, 'DECIMAL(65,25)'],
    [{ precision: 50, scale: 10 }, 'DECIMAL(65,25)'],
    [{ precision: 65, scale: 0 }, 'DECIMAL(65,0)'],
  ])(
    'wraps a parameter of a column of %j in a cast to %s, which holds every value the column holds',
    (typeParams, castTo) => {
      const parameter = ParamRef.of('1', { codec: { codecId: 'mysql/decimal@1' } });
      expect(
        mysqlDecimalDescriptor.wrapParameter(parameter, {
          codecId: 'mysql/decimal@1',
          ...(typeParams === undefined ? {} : { typeParams }),
        }),
      ).toEqual(CastExpr.as(parameter, castTo));
    },
  );

  it('leaves a parameter of every other codec as it is', () => {
    const parameter = ParamRef.of(1, { codec: { codecId: 'mysql/int@1' } });
    expect(mysqlIntDescriptor.wrapParameter(parameter, { codecId: 'mysql/int@1' })).toBe(parameter);
  });

  it('projects a column into an include as its text, which JSON.parse would round as a number', () => {
    const value = ColumnRef.of('Price', 'amount');
    expect(
      mysqlDecimalDescriptor.projectJson(value, {
        codecId: 'mysql/decimal@1',
        typeParams: { precision: 65, scale: 30 },
      }),
    ).toEqual(CastExpr.as(value, 'CHAR'));
  });

  it('reads the text the server prints, padded to the scale', async () => {
    const codec = decimal({ precision: 65, scale: 30 });
    expect(await codec.fromWire('1.500000000000000000000000000000', { column })).toBe(
      '1.500000000000000000000000000000',
    );
  });

  it('refuses to read text that is not a decimal, naming the column', async () => {
    await expect(decimal().fromWire('abc', { column })).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'Column "Price"."amount" holds "abc", which is not decimal text. mysql/decimal@1 reads decimal text, such as "12.50".',
      meta: { codecId: 'mysql/decimal@1', table: 'Price', column: 'amount' },
    });
  });

  it('writes decimal text without leading zeros or a minus sign on zero', async () => {
    const codec = decimal();
    expect([
      await codec.toWire('007.50', {}),
      await codec.toWire('-0.00', {}),
      await codec.toWire(`${'9'.repeat(35)}.${'1'.repeat(30)}`, {}),
    ]).toEqual(['7.50', '0.00', `${'9'.repeat(35)}.${'1'.repeat(30)}`]);
  });

  it.each([
    ['', 'decimal text, such as "12.50"'],
    ['1e5', 'decimal text, such as "12.50"'],
    ['NaN', 'decimal text, such as "12.50"'],
    [
      `1${'0'.repeat(35)}`,
      'a decimal number of at most 35 digits before the point and 30 after it',
    ],
    [
      `0.${'1'.repeat(31)}`,
      'a decimal number of at most 35 digits before the point and 30 after it',
    ],
  ])('refuses to write %j, which the parameter cast would change', async (value, holds) => {
    await expect(decimal().toWire(value, {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `Cannot write ${JSON.stringify(value)} to a mysql/decimal@1 value, which holds ${holds}.`,
    });
  });

  it('writes every value a column with more than 35 digits before the point holds, and refuses digits its cast would round', async () => {
    const wide = decimal({ precision: 65, scale: 0 });
    const fiftyFive = decimal({ precision: 65, scale: 10 });
    expect([
      await wide.toWire('9'.repeat(65), {}),
      await wide.toWire(`-${'9'.repeat(65)}`, {}),
      await fiftyFive.toWire(`${'9'.repeat(55)}.${'9'.repeat(10)}`, {}),
    ]).toEqual(['9'.repeat(65), `-${'9'.repeat(65)}`, `${'9'.repeat(55)}.${'9'.repeat(10)}`]);
    await expect(wide.toWire('0.5', {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        'Cannot write "0.5" to a mysql/decimal@1 value, which holds a decimal number of at most 65 digits before the point and none after it.',
    });
    await expect(fiftyFive.toWire(`0.${'1'.repeat(11)}`, {})).rejects.toMatchObject({
      message: `Cannot write "0.${'1'.repeat(11)}" to a mysql/decimal@1 value, which holds a decimal number of at most 55 digits before the point and 10 after it.`,
    });
  });

  it('writes a filter value with more digits after the point than the column holds, which the cast compares unrounded', async () => {
    expect(await decimal({ precision: 10, scale: 2 }).toWire('1.005', {})).toBe('1.005');
  });

  it('allows trailing zeros past 30 digits after the point, which the cast drops without changing the value', async () => {
    expect(await decimal().toWire(`1.${'0'.repeat(40)}`, {})).toBe(`1.${'0'.repeat(40)}`);
  });

  it('converts to and from the stored value under the column parameters', () => {
    const codec = decimal({ precision: 10, scale: 2 });
    expect(codec.toDataTypeValue('1.5')).toEqual(
      mysqlDecimal.valueFrom('1.50', { precision: 10, scale: 2 }),
    );
    expect(
      codec.fromDataTypeValue(mysqlDecimal.valueFrom('2.25', { precision: 10, scale: 2 })),
    ).toBe('2.25');
  });
});
