import { describe, expect, it } from 'vitest';
import { sqliteResolveDefault } from '../src/core/default-normalizer';

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
