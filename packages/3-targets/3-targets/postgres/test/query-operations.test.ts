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
      const withGerman = buildOpAst(method, TEXT_COLUMN, 'prisma', { language: 'german' }).args[1];

      expect(withDefault?.kind).toBe('literal');
      expect(withDefault).toBeInstanceOf(LiteralExpr);
      expect((withDefault as LiteralExpr).value).toBe('english');
      expect((withGerman as LiteralExpr).value).toBe('german');
    });

    it('rejects a language Postgres has no configuration for', () => {
      const klingon = { language: 'klingon' };
      expect(() => buildOpAst(method, TEXT_COLUMN, 'prisma', klingon)).toThrow(/klingon/);
      expect(() => buildOpAst(method, TEXT_COLUMN, 'prisma', klingon)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
      );
    });

    it('dispatches on the textual trait', () => {
      expect(findOperation(method).self).toEqual({ traits: ['textual'] });
    });
  });

  describe('fullTextRank options', () => {
    const rankTemplate = (ast: OperationExpr) => ast.lowering?.template;

    it('renders ts_rank with no normalization argument when none is given', () => {
      expect(rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', {}))).toBe(
        'ts_rank(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}))',
      );
    });

    it('embeds normalization as a numeric literal in a third argument', () => {
      const ast = buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { normalization: 32 });

      expect(rankTemplate(ast)).toBe(
        'ts_rank(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}), {{arg2}})',
      );
      expect(ast.args[2]).toBeInstanceOf(LiteralExpr);
      expect((ast.args[2] as LiteralExpr).value).toBe(32);
    });

    it('renders ts_rank_cd when coverDensity is set', () => {
      expect(
        rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { coverDensity: true })),
      ).toBe(
        'ts_rank_cd(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}))',
      );
      expect(
        rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { coverDensity: false })),
      ).toBe('ts_rank(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}))');
    });

    it.each([-1, 64, 1.5])('rejects a normalization of %s', (normalization) => {
      expect(() => buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { normalization })).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
      );
    });
  });

  describe('fullTextHeadline options', () => {
    const optionsLiteral = (ast: OperationExpr) => (ast.args[2] as LiteralExpr | undefined)?.value;

    it('omits the options argument when only the language is given', () => {
      const ast = buildOpAst('fullTextHeadline', TEXT_COLUMN, 'prisma', { language: 'german' });

      expect(ast.lowering?.template).toBe(
        'ts_headline({{arg1}}, {{self}}, websearch_to_tsquery({{arg1}}, {{arg0}}))',
      );
      // query, language — and no third argument.
      expect(ast.args).toHaveLength(2);
    });

    it("renders the options as Postgres's Key=Value list, in one literal", () => {
      const ast = buildOpAst('fullTextHeadline', TEXT_COLUMN, 'prisma', {
        startSel: '<mark>',
        stopSel: '</mark>',
        maxWords: 20,
        minWords: 5,
        highlightAll: false,
      });

      expect(ast.lowering?.template).toBe(
        'ts_headline({{arg1}}, {{self}}, websearch_to_tsquery({{arg1}}, {{arg0}}), {{arg2}})',
      );
      expect(optionsLiteral(ast)).toBe(
        'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5, HighlightAll=false',
      );
    });

    it('rejects a maxWords that is not a positive integer', () => {
      for (const maxWords of [0, -3, 2.5]) {
        expect(() => buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', { maxWords })).toThrow(
          expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
        );
      }
    });

    // Postgres itself requires MinWords strictly below MaxWords.
    it.each([
      [10, 5],
      [10, 10],
    ])('rejects minWords %i against maxWords %i', (minWords, maxWords) => {
      expect(() =>
        buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', { minWords, maxWords }),
      ).toThrow(expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }));
    });

    it('accepts minWords below maxWords', () => {
      expect(() =>
        buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', { minWords: 5, maxWords: 10 }),
      ).not.toThrow();
    });

    it.each(['', 'a,b', 'a=b', 'a"b', 'a b', 'a\\b'])('rejects the marker %o', (startSel) => {
      expect(() => buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', { startSel })).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
      );
    });

    it('rejects a highlightAll that is not a boolean', () => {
      expect(() =>
        buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', {
          highlightAll: 'yes' as unknown as never,
        }),
      ).toThrow(expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }));
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
