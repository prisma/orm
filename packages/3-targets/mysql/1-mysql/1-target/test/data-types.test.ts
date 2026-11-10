import {
  renderSqlTypeName,
  resolveReportedSqlType,
  type SqlDataType,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import {
  mysqlBigint,
  mysqlChar,
  mysqlDataTypes,
  mysqlDatetime,
  mysqlDatetimeText,
  mysqlEnum,
  mysqlInt,
  mysqlText,
  mysqlVarchar,
  renderMysqlEnumType,
} from '../src/core/data-types';

const reported = (text: string) => ({ text, kind: undefined, schema: undefined, name: undefined });

describe('MySQL data types', () => {
  it('registers the types this target writes', () => {
    expect(mysqlDataTypes.map((type) => type.id).sort()).toEqual([
      'mysql/bigint',
      'mysql/char',
      'mysql/date',
      'mysql/datetime',
      'mysql/duration',
      'mysql/enum',
      'mysql/int',
      'mysql/text',
      'mysql/time',
      'mysql/timestamp',
      'mysql/varchar',
      'sql/raw',
    ]);
  });

  it.each([
    [mysqlInt, {}, 'int'],
    [mysqlBigint, {}, 'bigint'],
    [mysqlText, {}, 'text'],
    [mysqlVarchar, { length: 191 }, 'varchar(191)'],
    [mysqlChar, {}, 'char'],
    [mysqlChar, { length: 36 }, 'char(36)'],
    [mysqlDatetime, {}, 'datetime'],
    [mysqlDatetime, { precision: 3 }, 'datetime(3)'],
    [mysqlEnum, { values: ['USER', 'ADMIN'] }, "enum('USER','ADMIN')"],
  ])('writes %s with %j as %s', (type, params, text) => {
    expect(renderSqlTypeName(type as SqlDataType, params)).toBe(text);
  });

  it.each([
    ['int', 'mysql/int', {}],
    ['integer', 'mysql/int', {}],
    ['bigint', 'mysql/bigint', {}],
    ['varchar(191)', 'mysql/varchar', { length: 191 }],
    ['char(1)', 'mysql/char', { length: 1 }],
    ['text', 'mysql/text', {}],
    ['datetime', 'mysql/datetime', {}],
    ['datetime(3)', 'mysql/datetime', { precision: 3 }],
  ])('reads the reported type %s as %s', (text, id, typeParams) => {
    const resolved = resolveReportedSqlType(reported(text), mysqlDataTypes);
    expect({ id: resolved?.dataType.id, typeParams: resolved?.typeParams }).toEqual({
      id,
      typeParams,
    });
  });

  it('claims no reported enum type, which is compared by its catalog text', () => {
    expect(
      resolveReportedSqlType(reported("enum('USER','ADMIN')"), mysqlDataTypes),
    ).toBeUndefined();
  });

  it('normalizes a datetime precision of 0 away, as MySQL prints it', () => {
    expect(mysqlDatetime.sql.normalize({ precision: 0 })).toEqual({});
    expect(mysqlDatetime.sql.normalize({ precision: 3 })).toEqual({ precision: 3 });
  });

  it('gives a bare char its length of 1', () => {
    expect(mysqlChar.sql.normalize({})).toEqual({ length: 1 });
  });
});

describe('mysql/enum', () => {
  it('quotes each member and doubles quotes and backslashes inside one', () => {
    expect(renderMysqlEnumType(["it's", 'a\\b'])).toBe("enum('it''s','a\\\\b')");
  });

  it('refuses a column type with no members', () => {
    expect(() => renderMysqlEnumType(undefined)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' }),
    );
    expect(() => renderMysqlEnumType([])).toThrow(/at least one member/);
  });

  it('holds only its members', () => {
    expect(mysqlEnum.valueFrom('USER', { values: ['USER', 'ADMIN'] }).value).toBe('USER');
    expect(() => mysqlEnum.valueFrom('OWNER', { values: ['USER', 'ADMIN'] })).toThrow(
      /one of the members USER, ADMIN/,
    );
  });

  it('takes text values', () => {
    expect(Object.keys(mysqlEnum.casts)).toEqual(['mysql/text']);
  });
});

describe('value forms', () => {
  it('stores an int as a JSON number and refuses one outside 32 bits', () => {
    expect(mysqlInt.valueFrom(42, {}).value).toBe(42);
    expect(() => mysqlInt.valueFrom(2 ** 31, {})).toThrow();
  });

  it('stores a bigint as digit text and casts an int to it', () => {
    expect(mysqlBigint.valueFrom('9007199254740993', {}).value).toBe('9007199254740993');
    expect(mysqlBigint.casts[mysqlInt.id]?.(7)).toBe('7');
  });

  it('refuses varchar text longer than its length', () => {
    expect(mysqlVarchar.valueFrom('abc', { length: 3 }).value).toBe('abc');
    expect(() => mysqlVarchar.valueFrom('abcd', { length: 3 })).toThrow(/at most 3 characters/);
  });

  it('refuses a second character in a bare char', () => {
    expect(() => mysqlChar.valueFrom('ab', {})).toThrow(/at most 1 character/);
  });

  it('stores a datetime as ISO text without an offset', () => {
    expect(mysqlDatetimeText('2024-01-01 12:34:56.500')).toBe('2024-01-01T12:34:56.5');
    expect(mysqlDatetime.valueFrom('2024-01-01 00:00:00', {}).value).toBe('2024-01-01T00:00:00');
    expect(() => mysqlDatetime.valueFrom('2024-01-01T00:00:00Z', {})).toThrow();
    expect(() => mysqlDatetime.valueFrom('0999-12-31T00:00:00', {})).toThrow();
  });
});
