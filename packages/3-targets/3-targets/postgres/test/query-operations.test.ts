import { createSqlOperationRegistry } from '@internal/sql-operations';
import { LiteralExpr, OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { POSTGRES_TEXT_SEARCH_LANGUAGES } from '../src/core/text-search-languages';
import postgresTargetDescriptor from '../src/exports/runtime';

const TEXT_COLUMN_AST = ParamRef.of('body', { codec: { codecId: 'pg/text@1' } });

// Stands in for a contract-bound text column: the operations take an Expression on `self` and read
// its AST, not a bare AST node.
const TEXT_COLUMN = {
  returnType: { codecId: 'pg/text@1', nullable: false },
  buildAst: () => TEXT_COLUMN_AST,
};

function operations() {
  return postgresTargetDescriptor.queryOperations?.() ?? {};
}

function findOperation(method: string) {
  const op = operations()[method];
  if (!op) throw new Error(`${method} not found`);
  return op;
}

function buildOpAst(method: string, ...args: unknown[]): OperationExpr {
  const expr = findOperation(method).impl(...(args as never[])) as unknown as {
    buildAst(): OperationExpr;
  };
  return expr.buildAst();
}

describe('postgres target query operations', () => {
  it('ilike lowers to the infix ILIKE template', () => {
    const ast = buildOpAst('ilike', TEXT_COLUMN, '%launch%');

    expect(ast).toBeInstanceOf(OperationExpr);
    expect(ast.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'infix',
      template: '{{self}} ILIKE {{arg0}}',
    });
    expect(ast.returns).toEqual({ codecId: 'pg/bool@1', nullable: false });
  });

  const fullTextOps: ReadonlyArray<readonly [string, string, string]> = [
    [
      'fullTextMatches',
      'pg/bool@1',
      'to_tsvector({{arg1}}, {{self}}) @@ websearch_to_tsquery({{arg1}}, {{arg0}})',
    ],
    [
      'fullTextRank',
      'pg/float4@1',
      'ts_rank(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}))',
    ],
    [
      'fullTextHeadline',
      'pg/text@1',
      'ts_headline({{arg1}}, {{self}}, websearch_to_tsquery({{arg1}}, {{arg0}}))',
    ],
  ];

  describe.each(fullTextOps)('%s', (method, returnCodecId, template) => {
    it('builds an OperationExpr with the expected lowering and return codec', () => {
      const ast = buildOpAst(method, TEXT_COLUMN, 'prisma');

      expect(ast).toBeInstanceOf(OperationExpr);
      expect(ast.lowering).toEqual({ targetFamily: 'sql', strategy: 'function', template });
      expect(ast.returns).toEqual({ codecId: returnCodecId, nullable: false });
    });

    it('binds the query as a pg/text@1 parameter', () => {
      const queryArg = buildOpAst(method, TEXT_COLUMN, 'prisma').args[0];

      expect(queryArg).toBeInstanceOf(ParamRef);
      expect((queryArg as ParamRef).value).toBe('prisma');
      expect((queryArg as ParamRef).codec?.codecId).toBe('pg/text@1');
    });

    it('embeds the language as a literal, defaulting to english', () => {
      const withDefault = buildOpAst(method, TEXT_COLUMN, 'prisma').args[1];
      const withGerman = buildOpAst(method, TEXT_COLUMN, 'prisma', 'german').args[1];

      expect(withDefault?.kind).toBe('literal');
      expect(withDefault).toBeInstanceOf(LiteralExpr);
      expect((withDefault as LiteralExpr).value).toBe('english');
      expect((withGerman as LiteralExpr).value).toBe('german');
    });

    it('rejects a language Postgres has no configuration for', () => {
      expect(() => buildOpAst(method, TEXT_COLUMN, 'prisma', 'klingon')).toThrow(/klingon/);
      expect(() => buildOpAst(method, TEXT_COLUMN, 'prisma', 'klingon')).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
      );
    });

    it('dispatches on the textual trait', () => {
      expect(findOperation(method).self).toEqual({ traits: ['textual'] });
    });
  });

  it('ilike dispatches on the textual trait', () => {
    expect(findOperation('ilike').self).toEqual({ traits: ['textual'] });
  });

  it('registers every operation in a SQL operation registry', () => {
    const registry = createSqlOperationRegistry();
    for (const [name, op] of Object.entries(operations())) {
      registry.register(name, op);
    }

    const entries = registry.entries();
    for (const method of ['ilike', 'fullTextMatches', 'fullTextRank', 'fullTextHeadline']) {
      expect(entries[method]).toBeDefined();
    }
  });

  it('the runtime target descriptor contributes exactly these four operations', () => {
    expect(Object.keys(operations()).sort()).toEqual([
      'fullTextHeadline',
      'fullTextMatches',
      'fullTextRank',
      'ilike',
    ]);
  });
});

describe('the text-search language allowlist', () => {
  it('is exactly the configurations a stock PostgreSQL server ships with', () => {
    expect(POSTGRES_TEXT_SEARCH_LANGUAGES).toEqual([
      'simple',
      'arabic',
      'armenian',
      'basque',
      'catalan',
      'danish',
      'dutch',
      'english',
      'finnish',
      'french',
      'german',
      'greek',
      'hindi',
      'hungarian',
      'indonesian',
      'irish',
      'italian',
      'lithuanian',
      'nepali',
      'norwegian',
      'portuguese',
      'romanian',
      'russian',
      'serbian',
      'spanish',
      'swedish',
      'tamil',
      'turkish',
      'yiddish',
    ]);
  });
});
