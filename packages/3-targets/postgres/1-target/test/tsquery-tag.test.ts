import { LiteralExpr, OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { tsquery } from '../src/exports/full-text';

function astOf(expression: { buildAst(): unknown }): OperationExpr {
  const ast = expression.buildAst();
  if (!(ast instanceof OperationExpr)) throw new Error('expected an OperationExpr');
  return ast;
}

function assembled(expression: { buildAst(): unknown }): unknown {
  const self = astOf(expression).self;
  return self instanceof ParamRef ? self.value : self;
}

describe('tsquery', () => {
  it.each([
    ['a plain value', 'zebra', "'zebra':*"],
    ['a quote, doubled', "zebra's", "'zebra''s':*"],
    ['a backslash, escaped', 'x\\y', "'x\\\\y':*"],
    [
      'operator characters, kept inside the term',
      "a & b | !c: d' | 'e",
      "'a & b | !c: d'' | ''e':*",
    ],
    ['spaces, kept inside the term', ' new  york ', "' new  york ':*"],
    ['an empty value, as a single space', '', "' ':*"],
    ['a trailing backslash, escaped', 'abc\\', "'abc\\\\':*"],
    ['a value made only of quotes', "'''", "'''''''':*"],
  ])('quotes %s as one term', (_label, value, expected) => {
    expect(assembled(tsquery`${value}:*`)).toBe(expected);
  });

  it('quotes each of several interpolations and keeps the literal parts as written', () => {
    expect(assembled(tsquery`(${'new'}:* | ${"o'brien"}) & !'graze'`)).toBe(
      "('new':* | 'o''brien') & !'graze'",
    );
  });

  it('passes a template without interpolations through as written', () => {
    expect(assembled(tsquery`'zebra' & !'graze'`)).toBe("'zebra' & !'graze'");
  });

  it('lowers to to_tsquery over the language literal and one bound text parameter', () => {
    const ast = astOf(tsquery`${'zebra'}:*`);

    expect(ast.lowering).toEqual({
      targetFamily: 'sql',
      template: 'to_tsquery({{arg0}}, {{self}})',
    });
    expect(ast.self).toEqual(ParamRef.of("'zebra':*", { codec: { codecId: 'pg/text@1' } }));
    expect(ast.args).toEqual([LiteralExpr.of('english')]);
    expect(ast.returns).toEqual({ codecId: 'pg/tsquery@1', nullable: false });
  });

  it('takes the language through tsquery({ language })', () => {
    const ast = astOf(tsquery({ language: 'german' })`${'zebra'}:*`);

    expect(ast.args).toEqual([LiteralExpr.of('german')]);
    expect(ast.self).toEqual(ParamRef.of("'zebra':*", { codec: { codecId: 'pg/text@1' } }));
  });

  it('rejects a literal part JavaScript could not read, rather than dropping it', () => {
    expect(() => tsquery`\unicode & ${'zebra'}:*`).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ARGUMENT_INVALID',
        meta: expect.objectContaining({ argument: 'literal part 0' }),
      }),
    );
    expect(() => tsquery`${'zebra'}:* & \x`).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ARGUMENT_INVALID',
        meta: expect.objectContaining({ argument: 'literal part 1' }),
      }),
    );
  });

  it('rejects a language Postgres has no configuration for, before any template', () => {
    const klingon = { language: 'klingon' as never };
    expect(() => tsquery(klingon)).toThrow(/klingon/);
    expect(() => tsquery(klingon)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
    );
  });
});
