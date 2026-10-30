import { describe, expect, it } from 'vitest';
import {
  SQLITE_DATE_NOW_EXPRESSION,
  SQLITE_NOW_EXPRESSION,
  SQLITE_TIME_NOW_EXPRESSION,
  sqliteNowExpressionFor,
} from '../src/core/datetime-text';
import { readSqliteDefault, sqliteResolveDefault } from '../src/core/default-normalizer';

const literal = (body: string | number) => ({
  kind: 'literal',
  literal: { kind: 'value', body },
});

const textColumn = { typeText: 'text', dataTypeId: 'sqlite/text', many: false };

describe('sqliteResolveDefault', () => {
  it('passes a literal default through unchanged', () => {
    const stored = { kind: 'literal' as const, value: 'draft' };
    expect(sqliteResolveDefault(stored, textColumn)).toBe(stored);
  });

  it.each([
    ['CURRENT_TIMESTAMP'],
    ["datetime('now')"],
    ['(CURRENT_TIMESTAMP)'],
    ["strftime('%Y-%m-%dT%H:%M:%fZ','now')"],
  ])('names the authored expression %j now(), as introspection does', (expression) => {
    expect(sqliteResolveDefault({ kind: 'function', expression }, textColumn)).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it.each([
    ["date('now')", "date('now')"],
    ['DATE("now")', "date('now')"],
    ["strftime('%H:%M:%f', 'now')", "strftime('%H:%M:%f','now')"],
  ])('names the authored expression %j %j, as introspection does', (expression, named) => {
    expect(sqliteResolveDefault({ kind: 'function', expression }, textColumn)).toEqual({
      kind: 'function',
      expression: named,
    });
  });

  it.each([
    ['sqlite/datetime', 'now()'],
    ['sqlite/date', "date('now')"],
    ['sqlite/time', "strftime('%H:%M:%f','now')"],
  ])('names now() on %s as the expression its data type writes, %j', (dataTypeId, named) => {
    expect(
      sqliteResolveDefault(
        { kind: 'function', expression: 'now()' },
        { typeText: 'text', dataTypeId, many: false },
      ),
    ).toEqual({ kind: 'function', expression: named });
  });

  it('keeps an expression that writes a literal as the expression', () => {
    expect(sqliteResolveDefault({ kind: 'function', expression: "'draft'" }, textColumn)).toEqual({
      kind: 'function',
      expression: "'draft'",
    });
  });

  it('keeps an unrecognised expression as a function default', () => {
    expect(
      sqliteResolveDefault(
        { kind: 'function', expression: 'random()' },
        { typeText: 'integer', dataTypeId: 'sqlite/integer', many: false },
      ),
    ).toEqual({
      kind: 'function',
      expression: 'random()',
    });
  });
});

describe('readSqliteDefault', () => {
  it.each([
    ['a quoted string on a text column', "'O''Reilly'", 'TEXT', "O'Reilly"],
    ['a numeral on a text column, which stores its text', '42', 'TEXT', '42'],
    ['a bare integer on an integer column', '7', 'INTEGER', 7],
    ['a quoted integer on an integer column, which stores the number', "'7'", 'INTEGER', 7],
    ['a negative integer in parentheses', '(-42)', 'INTEGER', -42],
    [
      'an integer past the safe range, as digit text',
      '9007199254740993',
      'INTEGER',
      '9007199254740993',
    ],
    ['a fraction on a real column', '1.5', 'REAL', 1.5],
    ['a number past the range of a double', '9e999', 'REAL', Number.POSITIVE_INFINITY],
    ['a quoted string on a blob column, which stays text', "'7'", 'BLOB', '7'],
    ['a date and time on a text column', "'2024-01-01T00:00:00Z'", 'TEXT', '2024-01-01T00:00:00Z'],
  ])('takes the body out of %s', (_name, raw, declaredType, body) => {
    expect(readSqliteDefault(raw, declaredType)).toEqual(literal(body));
  });

  it.each([
    [SQLITE_NOW_EXPRESSION],
    ["(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"],
    ["STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')"],
    ["  strftime (  '%Y-%m-%dT%H:%M:%fZ' ,\n 'now'  )  "],
    ['strftime("%Y-%m-%dT%H:%M:%fZ","now")'],
    ['CURRENT_TIMESTAMP'],
    ["datetime('now')"],
  ])('reads %j, the current instant, as now()', (raw) => {
    expect(readSqliteDefault(raw, 'TEXT')).toEqual({ kind: 'function', expression: 'now()' });
  });

  it.each([
    [SQLITE_DATE_NOW_EXPRESSION, SQLITE_DATE_NOW_EXPRESSION],
    ["(date('now'))", SQLITE_DATE_NOW_EXPRESSION],
    ['DATE("now")', SQLITE_DATE_NOW_EXPRESSION],
    [SQLITE_TIME_NOW_EXPRESSION, SQLITE_TIME_NOW_EXPRESSION],
    ["(strftime('%H:%M:%f', 'now'))", SQLITE_TIME_NOW_EXPRESSION],
  ])('reads %j, the current date or time of day, as %j, not as the instant now()', (raw, named) => {
    expect(readSqliteDefault(raw, 'TEXT')).toEqual({ kind: 'function', expression: named });
  });

  it.each([
    ["X'6869'", [0x68, 0x69]],
    ["x'00ff'", [0x00, 0xff]],
    ["X''", []],
  ])('reads the blob literal %j as the bytes a blob row carries', (raw, bytes) => {
    expect(readSqliteDefault(raw, 'BLOB')).toEqual({
      kind: 'literal',
      literal: { kind: 'value', body: new Uint8Array(bytes) },
    });
  });

  it.each([
    ["strftime('%Y-%m-%d','now')"],
    ["strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')"],
    ['random()'],
    ['CURRENT_DATE'],
    ['CURRENT_TIME'],
  ])('keeps %j as a function default', (raw) => {
    expect(readSqliteDefault(raw, 'TEXT')).toEqual({ kind: 'function', expression: raw });
  });

  it('reads NULL as SQL NULL', () => {
    expect(readSqliteDefault('NULL', 'TEXT')).toEqual({ kind: 'null' });
  });
});

describe('the expression a now() default is written as', () => {
  it('is the current date on sqlite/date, the time of day on sqlite/time, and the instant on sqlite/datetime, on text and on a column of no known data type', () => {
    expect({
      date: sqliteNowExpressionFor('sqlite/date'),
      time: sqliteNowExpressionFor('sqlite/time'),
      datetime: sqliteNowExpressionFor('sqlite/datetime'),
      text: sqliteNowExpressionFor('sqlite/text'),
      character: sqliteNowExpressionFor('sqlite/character'),
      characterVarying: sqliteNowExpressionFor('sqlite/character-varying'),
      unknown: sqliteNowExpressionFor(undefined),
    }).toEqual({
      date: "date('now')",
      time: "strftime('%H:%M:%f','now')",
      datetime: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      text: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      character: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      characterVarying: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      unknown: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    });
  });

  it.each(['sqlite/duration', 'sqlite/integer', 'sqlite/real', 'sqlite/blob', 'sqlite/json'])(
    'does not exist on %s, which holds no current date or time',
    (dataTypeId) => {
      expect(sqliteNowExpressionFor(dataTypeId)).toBeUndefined();
    },
  );

  it.each(['sqlite/datetime', 'sqlite/date', 'sqlite/time'])(
    'on %s, is read back as the contract names now() on that data type',
    (dataTypeId) => {
      const column = { typeText: 'text', dataTypeId, many: false };
      expect(readSqliteDefault(`(${sqliteNowExpressionFor(dataTypeId)})`, 'TEXT')).toEqual(
        sqliteResolveDefault({ kind: 'function', expression: 'now()' }, column),
      );
    },
  );
});
