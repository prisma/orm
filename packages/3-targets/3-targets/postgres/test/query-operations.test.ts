import { createSqlOperationRegistry } from '@internal/sql-operations';
import { LiteralExpr, OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { POSTGRES_TEXT_SEARCH_LANGUAGES } from '../src/core/text-search-languages';
import {
  type FullTextDocumentGroups,
  fullTextDocument,
  phrasetoTsquery,
  plaintoTsquery,
  toTsquery,
  websearchToTsquery,
} from '../src/exports/full-text';
import postgresTargetDescriptor from '../src/exports/runtime';

const TEXT_COLUMN_AST = ParamRef.of('body', { codec: { codecId: 'pg/text@1' } });

// Stands in for a contract-bound text column: the operations take an Expression on `self` and read
// its AST, not a bare AST node.
const TEXT_COLUMN = {
  returnType: { codecId: 'pg/text@1', nullable: false },
  buildAst: () => TEXT_COLUMN_AST,
};

const TSQUERY = toTsquery("'zebra' & !'graze'");
const TSQUERY_AST = TSQUERY.buildAst();

const PARSER_HELPERS = { phrasetoTsquery, plaintoTsquery, toTsquery, websearchToTsquery };
const PARSERS = Object.keys(PARSER_HELPERS).sort();

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
      template: '{{self}} ILIKE {{arg0}}',
    });
    expect(ast.returns).toEqual({ codecId: 'pg/bool@1', nullable: false });
  });

  const fullTextOps: ReadonlyArray<readonly [string, string, string]> = [
    ['fullTextMatches', 'pg/bool@1', 'to_tsvector({{arg1}}, {{self}}) @@ {{arg0}}'],
    ['fullTextRank', 'pg/float4@1', 'ts_rank(to_tsvector({{arg1}}, {{self}}), {{arg0}})'],
    ['fullTextHeadline', 'pg/text@1', 'ts_headline({{arg1}}, {{self}}, {{arg0}})'],
  ];

  describe.each(fullTextOps)('%s', (method, returnCodecId, template) => {
    it('builds an OperationExpr with the expected lowering and return codec', () => {
      const ast = buildOpAst(method, TEXT_COLUMN, 'prisma');

      expect(ast).toBeInstanceOf(OperationExpr);
      expect(ast.lowering).toEqual({ targetFamily: 'sql', template });
      expect(ast.returns).toEqual({ codecId: returnCodecId, nullable: false });
    });

    it('binds a tsquery value read back from a query as a pg/tsquery@1 parameter, unchanged', () => {
      const queryArg = buildOpAst(method, TEXT_COLUMN, "'zeb':*").args[0];

      expect(queryArg).toEqual(ParamRef.of("'zeb':*", { codec: { codecId: 'pg/tsquery@1' } }));
    });

    it('embeds a tsquery expression as the query argument without binding a parameter', () => {
      const ast = buildOpAst(method, TEXT_COLUMN, TSQUERY);

      expect(ast.args[0]).toBe(TSQUERY_AST);
      expect(ast.args[0]).toBeInstanceOf(OperationExpr);
      expect(ast.args.filter((arg) => arg instanceof ParamRef)).toEqual([]);
    });

    it('leaves the query unparsed on the SQL side', () => {
      expect(buildOpAst(method, TEXT_COLUMN, 'prisma').lowering?.template).not.toContain(
        'websearch_to_tsquery',
      );
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

  describe.each([
    ['fullTextMatches', (document: string) => `${document} @@ {{arg0}}`],
    ['fullTextRank', (document: string) => `ts_rank(${document}, {{arg0}})`],
  ])('%s over weight groups', (method, wrap) => {
    const column = (name: string, nullable: boolean) => {
      const ast = ParamRef.of(name, { codec: { codecId: 'pg/text@1' } });
      return { returnType: { codecId: 'pg/text@1', nullable }, buildAst: () => ast };
    };
    const title = column('title', false);
    const subtitle = column('subtitle', true);
    const body = column('body', true);
    const weightedDocument = `(setweight(to_tsvector({{arg1}}, coalesce({{self}}, '')), 'A') || setweight(to_tsvector({{arg1}}, coalesce({{arg2}}, '')), 'A') || setweight(to_tsvector({{arg1}}, coalesce({{arg3}}, '')), 'B'))`;
    const documentOf = (groups: unknown) => fullTextDocument(groups as FullTextDocumentGroups);

    describe('of a full-text index', () => {
      const searchIndex = {
        type: 'fullText',
        options: { weightGroups: [['title', 'subtitle'], ['body']], language: 'german' },
        columns: { title, subtitle, body },
      };

      it('searches the document the index renders, in the language of the index', () => {
        const ast = buildOpAst(method, searchIndex, 'prisma');

        expect(ast.lowering?.template).toBe(wrap(weightedDocument));
        expect(ast.self).toBe(title.buildAst());
        expect(ast.args.slice(2)).toEqual([subtitle.buildAst(), body.buildAst()]);
        expect((ast.args[1] as LiteralExpr).value).toBe('german');
      });

      it('refuses a language option, which the index states', () => {
        expect(() => buildOpAst(method, searchIndex, 'prisma', { language: 'german' })).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.ARGUMENT_INVALID',
            message: expect.stringContaining('language'),
            meta: { helper: method, argument: 'options', received: 'german' },
          }),
        );
      });

      it('refuses an index of another type', () => {
        const ginIndex = { type: 'gin', options: undefined, columns: { title } };

        expect(() => buildOpAst(method, ginIndex, 'prisma')).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.ARGUMENT_INVALID',
            message: expect.stringContaining('"gin"'),
            meta: { helper: method, argument: 'document', received: 'gin' },
          }),
        );
      });

      it('refuses a full-text index without a column its weight groups name', () => {
        const partial = { ...searchIndex, columns: { title, subtitle } };

        expect(() => buildOpAst(method, partial, 'prisma')).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.ARGUMENT_INVALID',
            meta: { helper: method, argument: 'document', received: 'body' },
          }),
        );
      });

      it('refuses a full-text index whose options are not a full-text definition', () => {
        const broken = { ...searchIndex, options: { weightGroups: [['title']] } };

        expect(() => buildOpAst(method, broken, 'prisma')).toThrow(
          expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
        );
      });
    });

    describe('of fullTextDocument', () => {
      it('searches the weighted document, in the language option', () => {
        const ast = buildOpAst(method, documentOf([[title, subtitle], [body]]), 'prisma', {
          language: 'german',
        });

        expect(ast.lowering?.template).toBe(wrap(weightedDocument));
        expect(ast.self).toBe(title.buildAst());
        expect(ast.args.slice(2)).toEqual([subtitle.buildAst(), body.buildAst()]);
        expect((ast.args[1] as LiteralExpr).value).toBe('german');
      });

      it('takes a bare column as a group of one', () => {
        expect(buildOpAst(method, documentOf([title, body]), 'prisma').lowering?.template).toBe(
          wrap(
            `(setweight(to_tsvector({{arg1}}, coalesce({{self}}, '')), 'A') || setweight(to_tsvector({{arg1}}, coalesce({{arg2}}, '')), 'B'))`,
          ),
        );
      });

      it('searches one column in one group exactly as the column form does', () => {
        expect(buildOpAst(method, documentOf([[body]]), 'prisma').lowering).toEqual(
          buildOpAst(method, body, 'prisma').lowering,
        );
      });
    });

    it('refuses weight groups passed as nested arrays, which name neither an index nor a document', () => {
      expect(() => buildOpAst(method, [[title], [body]], 'prisma')).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          message: expect.stringContaining('fullTextDocument'),
          meta: { helper: method, argument: 'document', received: 'array' },
        }),
      );
    });
  });

  describe('fullTextDocument', () => {
    const column = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => TEXT_COLUMN_AST,
    };

    it.each([
      ['no group', []],
      ['an empty group', [[column], []]],
      ['more than four groups', [[column], [column], [column], [column], [column]]],
    ])('refuses %s', (_label, groups) => {
      expect(() => fullTextDocument(groups as unknown as FullTextDocumentGroups)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          meta: expect.objectContaining({ helper: 'fullTextDocument', argument: 'groups' }),
        }),
      );
    });
  });

  it('places the rank normalization before the trailing columns', () => {
    const document = fullTextDocument([
      [TEXT_COLUMN],
      [TEXT_COLUMN],
    ] as unknown as FullTextDocumentGroups);
    const ast = buildOpAst('fullTextRank', document, 'prisma', { normalization: 32 });

    expect(ast.lowering?.template).toBe(
      `ts_rank((setweight(to_tsvector({{arg1}}, coalesce({{self}}, '')), 'A') || setweight(to_tsvector({{arg1}}, coalesce({{arg3}}, '')), 'B')), {{arg0}}, {{arg2}})`,
    );
    expect((ast.args[2] as LiteralExpr).value).toBe(32);
  });

  describe('fullTextRank options', () => {
    const rankTemplate = (ast: OperationExpr) => ast.lowering?.template;

    it('renders ts_rank with no normalization argument when none is given', () => {
      expect(rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', {}))).toBe(
        'ts_rank(to_tsvector({{arg1}}, {{self}}), {{arg0}})',
      );
    });

    it('embeds normalization as a numeric literal in a third argument', () => {
      const ast = buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { normalization: 32 });

      expect(rankTemplate(ast)).toBe(
        'ts_rank(to_tsvector({{arg1}}, {{self}}), {{arg0}}, {{arg2}})',
      );
      expect(ast.args[2]).toBeInstanceOf(LiteralExpr);
      expect((ast.args[2] as LiteralExpr).value).toBe(32);
    });

    it('renders ts_rank_cd when coverDensity is set', () => {
      expect(
        rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { coverDensity: true })),
      ).toBe('ts_rank_cd(to_tsvector({{arg1}}, {{self}}), {{arg0}})');
      expect(
        rankTemplate(buildOpAst('fullTextRank', TEXT_COLUMN, 'prisma', { coverDensity: false })),
      ).toBe('ts_rank(to_tsvector({{arg1}}, {{self}}), {{arg0}})');
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

      expect(ast.lowering?.template).toBe('ts_headline({{arg1}}, {{self}}, {{arg0}})');
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

      expect(ast.lowering?.template).toBe('ts_headline({{arg1}}, {{self}}, {{arg0}}, {{arg2}})');
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

    it.each([{ minWords: 35 }, { maxWords: 15 }])(
      "rejects %o against Postgres's default for the other bound",
      (options) => {
        expect(() => buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', options)).toThrow(
          expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
        );
      },
    );

    it('does not compare minWords and maxWords under highlightAll', () => {
      expect(() =>
        buildOpAst('fullTextHeadline', TEXT_COLUMN, 'p', { maxWords: 10, highlightAll: true }),
      ).not.toThrow();
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
    for (const method of [
      'ilike',
      'fullTextMatches',
      'fullTextRank',
      'fullTextHeadline',
      ...PARSERS,
    ]) {
      expect(entries[method]).toBeDefined();
    }
  });

  it('the runtime target descriptor contributes exactly these eight operations', () => {
    expect(Object.keys(operations()).sort()).toEqual([
      'fullTextHeadline',
      'fullTextMatches',
      'fullTextRank',
      'ilike',
      ...PARSERS,
    ]);
  });

  describe.each(PARSERS)('%s as a query operation', (method) => {
    it('has no self, so it attaches to no column and the builder exposes it as a function', () => {
      expect(findOperation(method).self).toBeUndefined();
    });

    it('is the exported helper itself', () => {
      expect(findOperation(method).impl).toBe(
        PARSER_HELPERS[method as keyof typeof PARSER_HELPERS],
      );
    });
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
