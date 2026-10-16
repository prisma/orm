import { describe, expect, it } from 'vitest';
import { SQLITE_NOW_EXPRESSION } from '../src/core/datetime-text';
import { readSqliteDefault, sqliteResolveDefault } from '../src/core/default-normalizer';

const literal = (body: string | number) => ({
  kind: 'literal',
  literal: { kind: 'value', body },
});

describe('sqliteResolveDefault', () => {
  it('passes a literal default through unchanged', () => {
    const stored = { kind: 'literal' as const, value: 'draft' };
    expect(sqliteResolveDefault(stored, 'text')).toBe(stored);
  });

  it.each([
    ['CURRENT_TIMESTAMP'],
    ["datetime('now')"],
    ['(CURRENT_TIMESTAMP)'],
    ["strftime('%Y-%m-%dT%H:%M:%fZ','now')"],
  ])('names the authored expression %j now(), as introspection does', (expression) => {
    expect(sqliteResolveDefault({ kind: 'function', expression }, 'text')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('keeps an expression that writes a literal as the expression', () => {
    expect(sqliteResolveDefault({ kind: 'function', expression: "'draft'" }, 'text')).toEqual({
      kind: 'function',
      expression: "'draft'",
    });
  });

  it('keeps an unrecognised expression as a function default', () => {
    expect(sqliteResolveDefault({ kind: 'function', expression: 'random()' }, 'integer')).toEqual({
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
  ])('reads %j as now()', (raw) => {
    expect(readSqliteDefault(raw, 'TEXT')).toEqual({ kind: 'function', expression: 'now()' });
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
