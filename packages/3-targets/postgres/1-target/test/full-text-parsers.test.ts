import { LiteralExpr, OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  phrasetoTsquery,
  plaintoTsquery,
  toTsquery,
  websearchToTsquery,
} from '../src/exports/full-text';

const TEXT_COLUMN_AST = ParamRef.of('title', { codec: { codecId: 'pg/text@1' } });

const TEXT_COLUMN = {
  returnType: { codecId: 'pg/text@1', nullable: false } as const,
  buildAst: () => TEXT_COLUMN_AST,
};

const parsers = [
  ['websearchToTsquery', 'websearch_to_tsquery', websearchToTsquery],
  ['toTsquery', 'to_tsquery', toTsquery],
  ['plaintoTsquery', 'plainto_tsquery', plaintoTsquery],
  ['phrasetoTsquery', 'phraseto_tsquery', phrasetoTsquery],
] as const;

function astOf(expression: { buildAst(): unknown }): OperationExpr {
  const ast = expression.buildAst();
  if (!(ast instanceof OperationExpr)) throw new Error('expected an OperationExpr');
  return ast;
}

describe.each(parsers)('%s', (method, fn, parse) => {
  it(`lowers to ${fn} over a language literal and a bound text parameter`, () => {
    const ast = astOf(parse('zebra grazing'));

    expect(ast.method).toBe(method);
    expect(ast.lowering).toEqual({ targetFamily: 'sql', template: `${fn}({{arg0}}, {{self}})` });
    expect(ast.self).toEqual(ParamRef.of('zebra grazing', { codec: { codecId: 'pg/text@1' } }));
    expect(ast.args).toHaveLength(1);
  });

  it('returns a non-null pg/tsquery@1 expression', () => {
    const expression = parse('zebra');

    expect(expression.returnType).toEqual({ codecId: 'pg/tsquery@1', nullable: false });
    expect(astOf(expression).returns).toEqual({ codecId: 'pg/tsquery@1', nullable: false });
  });

  it('embeds the language as a literal, defaulting to english', () => {
    const withDefault = astOf(parse('zebra')).args[0];
    const withGerman = astOf(parse('zebra', { language: 'german' })).args[0];

    expect(withDefault).toBeInstanceOf(LiteralExpr);
    expect((withDefault as LiteralExpr).value).toBe('english');
    expect((withGerman as LiteralExpr).value).toBe('german');
  });

  it('rejects a language Postgres has no configuration for', () => {
    const klingon = { language: 'klingon' as never };
    expect(() => parse('zebra', klingon)).toThrow(/klingon/);
    expect(() => parse('zebra', klingon)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
    );
  });

  it('passes a text expression through as the parsed input', () => {
    expect(astOf(parse(TEXT_COLUMN)).self).toBe(TEXT_COLUMN_AST);
  });
});
