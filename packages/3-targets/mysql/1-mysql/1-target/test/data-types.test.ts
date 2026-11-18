import {
  renderSqlTypeName,
  resolveReportedSqlType,
  type SqlDataType,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import {
  mysqlBigint,
  mysqlBoolean,
  mysqlChar,
  mysqlDataTypes,
  mysqlDatetime,
  mysqlDatetimeText,
  mysqlDecimal,
  mysqlDouble,
  mysqlEnum,
  mysqlInt,
  mysqlJson,
  mysqlLongblob,
  mysqlLongblobFromHexText,
  mysqlText,
  mysqlVarchar,
  renderMysqlEnumType,
} from '../src/core/data-types';

const reported = (text: string) => ({ text, kind: undefined, schema: undefined, name: undefined });

describe('MySQL data types', () => {
  it('registers the types this target writes', () => {
    expect(mysqlDataTypes.map((type) => type.id).sort()).toEqual([
      'mysql/bigint',
      'mysql/boolean',
      'mysql/char',
      'mysql/date',
      'mysql/datetime',
      'mysql/decimal',
      'mysql/double',
      'mysql/duration',
      'mysql/enum',
      'mysql/int',
      'mysql/json',
      'mysql/longblob',
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
    [mysqlDouble, {}, 'double'],
    [mysqlText, {}, 'text'],
    [mysqlVarchar, { length: 191 }, 'varchar(191)'],
    [mysqlChar, {}, 'char'],
    [mysqlChar, { length: 36 }, 'char(36)'],
    [mysqlDatetime, {}, 'datetime'],
    [mysqlDatetime, { precision: 3 }, 'datetime(3)'],
    [mysqlEnum, { values: ['USER', 'ADMIN'] }, "enum('USER','ADMIN')"],
    [mysqlBoolean, {}, 'tinyint(1)'],
    [mysqlLongblob, {}, 'longblob'],
    [mysqlJson, {}, 'json'],
  ])('writes %s with %j as %s', (type, params, text) => {
    expect(renderSqlTypeName(type as SqlDataType, params)).toBe(text);
  });

  it.each([
    ['int', 'mysql/int', {}],
    ['integer', 'mysql/int', {}],
    ['bigint', 'mysql/bigint', {}],
    ['double', 'mysql/double', {}],
    ['decimal(65,30)', 'mysql/decimal', { precision: 65, scale: 30 }],
    ['varchar(191)', 'mysql/varchar', { length: 191 }],
    ['char(1)', 'mysql/char', { length: 1 }],
    ['text', 'mysql/text', {}],
    ['datetime', 'mysql/datetime', {}],
    ['datetime(3)', 'mysql/datetime', { precision: 3 }],
    ['tinyint(1)', 'mysql/boolean', {}],
    ['longblob', 'mysql/longblob', {}],
    ['json', 'mysql/json', {}],
  ])('reads the reported type %s as %s', (text, id, typeParams) => {
    const resolved = resolveReportedSqlType(reported(text), mysqlDataTypes);
    expect({ id: resolved?.dataType.id, typeParams: resolved?.typeParams }).toEqual({
      id,
      typeParams,
    });
  });

  it('takes a default written as an int, a bigint or a decimal into a double', () => {
    expect([
      mysqlDouble.casts[mysqlInt.id]?.(7),
      mysqlDouble.casts[mysqlBigint.id]?.('9007199254740993'),
      mysqlDouble.casts[mysqlDecimal.id]?.('1.5'),
    ]).toEqual([7, 9007199254740992, 1.5]);
    expect(() => mysqlDouble.valueFrom(Number.NaN, {})).toThrow(/a finite number/);
  });

  it.each(['tinyint', 'tinyint(4)', 'tinyint unsigned', 'longtext', 'blob'])(
    'claims no reported %s, which no type this target writes stores',
    (text) => {
      expect(resolveReportedSqlType(reported(text), mysqlDataTypes)).toBeUndefined();
    },
  );

  it('stores a boolean as true or false, bytes as upper-case hex and a JSON document as itself', () => {
    expect({
      boolean: mysqlBoolean.valueFrom(true, {}).value,
      bytes: mysqlLongblob.valueFrom('00FF', {}).value,
      json: mysqlJson.valueFrom({ a: [1, null] }, {}).value,
      hexText: mysqlLongblobFromHexText('00ff'),
    }).toEqual({ boolean: true, bytes: '00FF', json: { a: [1, null] }, hexText: '00FF' });
    expect(() => mysqlBoolean.valueFrom(1, {})).toThrow(/a boolean/);
    expect(() => mysqlLongblob.valueFrom('00ff', {})).toThrow(/upper-case hexadecimal/);
    expect(() => mysqlLongblobFromHexText('0g')).toThrow(/is not hex text/);
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
