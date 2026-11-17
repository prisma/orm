import { describe, expect, it } from 'vitest';
import { readWrittenScalar } from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { type ExpressionAst, NumberLiteralExprAst } from '../src/syntax/ast/expressions';
import { greenNode } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';

function expressionOf(source: string): ExpressionAst {
  const cursor = new Cursor('schema.prisma', `@x(${source})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  const expression = [...(node?.argList()?.args() ?? [])][0]?.value();
  if (expression === undefined) throw new Error('expected an argument expression');
  return expression;
}

describe('readWrittenScalar', () => {
  it.each([
    ['a double-quoted string', '"a\\"b"', 'a"b'],
    ['a single-quoted string', "'a'", 'a'],
    ['a backtick string', '`a`', 'a'],
  ])('reads %s as a string', (_why, source, text) => {
    expect(readWrittenScalar(expressionOf(source))).toEqual({
      ok: true,
      written: { kind: 'string', text },
    });
  });

  it('reads a number as the text it is written as', () => {
    expect(readWrittenScalar(expressionOf('-1.50'))).toEqual({
      ok: true,
      written: { kind: 'number', text: '-1.50' },
    });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads %s as a boolean', (source, value) => {
    expect(readWrittenScalar(expressionOf(source))).toEqual({
      ok: true,
      written: { kind: 'boolean', value },
    });
  });

  it('reads a tagged literal as its tag and canonical text', () => {
    expect(readWrittenScalar(expressionOf('postgis.geometry`\n  POINT(0 0)\n`'))).toEqual({
      ok: true,
      written: { kind: 'tag', tag: 'postgis.geometry', text: 'POINT(0 0)' },
    });
  });

  it('refuses a tagged literal holding a NUL character', () => {
    expect(readWrittenScalar(expressionOf('sql`a\0b`'))).toEqual({ ok: false, reason: 'nul' });
  });

  it('refuses a tagged literal larger than the limit', () => {
    expect(readWrittenScalar(expressionOf(`sql\`${'a'.repeat(65537)}\``))).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it.each([
    ['an identifier', 'archived'],
    ['a function call', 'now()'],
    ['a list', '[1, 2]'],
    ['an object', '{ a: 1 }'],
  ])('refuses %s as not a literal', (found, source) => {
    expect(readWrittenScalar(expressionOf(source))).toEqual({
      ok: false,
      reason: 'not-a-literal',
      found,
    });
  });

  it('refuses a number literal with no number token as an expression', () => {
    const empty = new NumberLiteralExprAst(createSyntaxTree(greenNode('NumberLiteralExpr', [])));
    expect(readWrittenScalar(empty)).toEqual({
      ok: false,
      reason: 'not-a-literal',
      found: 'an expression',
    });
  });
});
