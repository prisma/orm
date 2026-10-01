import { describe, expect, it } from 'vitest';
import { parseSqliteDefault, sqliteResolveDefault } from '../src/core/default-normalizer';

describe('sqliteResolveDefault', () => {
  it('a literal default passes through unchanged', () => {
    const literal = { kind: 'literal' as const, value: 'draft' };
    expect(sqliteResolveDefault(literal, 'text')).toBe(literal);
  });

  it.each([['CURRENT_TIMESTAMP'], ["datetime('now')"], ['(CURRENT_TIMESTAMP)']])(
    'resolves the authored expression %j to now(), as introspection does',
    (expression) => {
      expect(sqliteResolveDefault({ kind: 'function', expression }, 'text')).toEqual({
        kind: 'function',
        expression: 'now()',
      });
    },
  );

  it('resolves an authored literal-shaped expression to the literal introspection reads', () => {
    expect(sqliteResolveDefault({ kind: 'function', expression: "'draft'" }, 'text')).toEqual({
      kind: 'literal',
      value: 'draft',
    });
  });

  it('keeps an unrecognised expression as a function default', () => {
    expect(sqliteResolveDefault({ kind: 'function', expression: 'random()' }, 'integer')).toEqual({
      kind: 'function',
      expression: 'random()',
    });
  });
});

describe('parseSqliteDefault', () => {
  it.each([
    ['9e999', 'Infinity'],
    ['-9e999', '-Infinity'],
    ['(9e999)', 'Infinity'],
    ['1.5e400', 'Infinity'],
    ['-1e309', '-Infinity'],
  ])(
    'reads the number %j, which only an infinity holds, as the text the float codecs store',
    (raw, value) => {
      expect(parseSqliteDefault(raw, 'real')).toEqual({ kind: 'literal', value });
    },
  );

  it.each([
    ['1e5', 100000],
    ['1.5', 1.5],
    ['-2', -2],
  ])('reads the number %j as the number it is', (raw, value) => {
    expect(parseSqliteDefault(raw, 'real')).toEqual({ kind: 'literal', value });
  });
});
