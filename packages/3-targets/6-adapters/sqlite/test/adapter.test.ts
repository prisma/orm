import {
  AggregateExpr,
  AndExpr,
  type AnyJsonValueProjection,
  type AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  CodecJsonValueProjection,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  ExistsExpr,
  FunctionCallExpr,
  FunctionSource,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { litParams } from '@repo/test-utils/lowered-params';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
                metadata: { codecId: 'sqlite/json@1', nativeType: 'text', nullable: true },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                userId: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                title: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as SqliteContract;

describe('SQLite adapter', () => {
  const adapter = createSqliteAdapter();

  it('SQLite adapter does not report sql.scalarList capability', () => {
    expect(adapter.profile.capabilities['sql']).not.toMatchObject({ scalarList: true });
  });

  describe('SELECT', () => {
    it('renders simple select', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('email', ColumnRef.of('user', 'email')),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user"');
    });

    it('renders select with WHERE and ? params', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ParamRef.of('test@example.com')));

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" = ?');
      expect(lowered.params).toEqual(litParams('test@example.com'));
    });

    it('renders neither LIMIT nor OFFSET when neither is set', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc')]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC');
    });

    it('renders LIMIT alone when only limit is set', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc')])
        .withLimit(10);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC LIMIT 10');
    });

    it('renders LIMIT -1 OFFSET n when only offset is set, since SQLite has no standalone OFFSET clause', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc')])
        .withOffset(5);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC LIMIT -1 OFFSET 5',
      );
    });

    it('renders NULLS LAST for an ORDER BY item carrying a nulls placement', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'desc', 'last')]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" DESC NULLS LAST',
      );
    });

    it('renders NULLS FIRST for an ORDER BY item carrying a nulls placement', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc', 'first')]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC NULLS FIRST',
      );
    });

    it('omits the NULLS clause when an ORDER BY item carries no placement', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'desc')]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" DESC');
    });

    it('renders ORDER BY, LIMIT, OFFSET unchanged when both are set', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc')])
        .withLimit(10)
        .withOffset(5);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC LIMIT 10 OFFSET 5',
      );
    });

    it('renders DISTINCT', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('email', ColumnRef.of('user', 'email'))])
        .withDistinct();

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('SELECT DISTINCT');
    });

    it('renders ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)', () => {
      const ast = SelectAst.from(TableSource.named('post')).withProjection([
        ProjectionItem.of('title', ColumnRef.of('post', 'title')),
        ProjectionItem.of(
          'rn',
          WindowFuncExpr.rowNumber({
            partitionBy: [ColumnRef.of('post', 'title')],
            orderBy: [new OrderByItem(ColumnRef.of('post', 'views'), 'desc')],
          }),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toEqual(
        'SELECT "post"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "post"."title" ORDER BY "post"."views" DESC) AS "rn" FROM "post"',
      );
    });

    // Mirrors the ROW_NUMBER-wrapped AST that the SQL ORM client planner
    // produces for `include('rel', r => r.distinct(cols).include('grandchild'))`:
    // an inner SELECT augments the projection with a
    // `ROW_NUMBER() OVER (PARTITION BY <distinct cols> ORDER BY <ranking cols>)`
    // column, wrapped in a derived table whose outer WHERE keeps only
    // `__prisma_distinct_rn = 1` — one representative row per partition.
    // The Postgres integration suite covers execution; this test pins the
    // SQLite renderer side: the same AST must lower to valid SQLite SQL
    // with no Postgres-only constructs.
    it('renders ROW_NUMBER dedup subquery for non-leaf distinct includes', () => {
      const innerRanked = SelectAst.from(TableSource.named('post'))
        .withProjection([
          ProjectionItem.of('title', ColumnRef.of('post', 'title')),
          ProjectionItem.of('id', ColumnRef.of('post', 'id')),
          ProjectionItem.of(
            '__prisma_distinct_rn',
            WindowFuncExpr.rowNumber({
              partitionBy: [ColumnRef.of('post', 'title')],
              orderBy: [new OrderByItem(ColumnRef.of('post', 'title'), 'asc')],
            }),
          ),
        ])
        .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ParamRef.of(1)));

      const ast = SelectAst.from(DerivedTableSource.as('posts__distinct', innerRanked))
        .withProjection([
          ProjectionItem.of('title', ColumnRef.of('posts__distinct', 'title')),
          ProjectionItem.of('id', ColumnRef.of('posts__distinct', 'id')),
        ])
        .withWhere(
          BinaryExpr.eq(ColumnRef.of('posts__distinct', '__prisma_distinct_rn'), LiteralExpr.of(1)),
        );

      const { sql } = adapter.lower(ast, { contract });
      // Full-string assertion: an exact-match check catches Postgres-only
      // leakage (`DISTINCT ON`, `LATERAL`, `::` casts) and brittle-substring
      // false positives in one pass.
      expect(sql).toEqual(
        'SELECT "posts__distinct"."title" AS "title", "posts__distinct"."id" AS "id" FROM (SELECT "post"."title" AS "title", "post"."id" AS "id", ROW_NUMBER() OVER (PARTITION BY "post"."title" ORDER BY "post"."title" ASC) AS "__prisma_distinct_rn" FROM "post" WHERE "post"."userId" = ?) AS "posts__distinct" WHERE "posts__distinct"."__prisma_distinct_rn" = 1',
      );
    });

    it('renders GROUP BY and HAVING', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([
          ProjectionItem.of('email', ColumnRef.of('user', 'email')),
          ProjectionItem.of('cnt', AggregateExpr.count()),
        ])
        .withGroupBy([ColumnRef.of('user', 'email')])
        .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)));

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('GROUP BY "user"."email"');
      expect(sql).toContain('HAVING COUNT(*) > 1');
    });

    it('renders table alias', () => {
      const ast = SelectAst.from(TableSource.named('user', 'u')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('u', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('FROM "user" AS "u"');
    });

    it.each([
      {
        name: 'without arguments or alias',
        source: FunctionSource.of('json_each', []),
        sql: 'SELECT 1 AS "value" FROM json_each()',
      },
      {
        name: 'with arguments and alias',
        source: FunctionSource.of('json_each', [ParamRef.of('[1, 2]')], { alias: 'entry' }),
        sql: 'SELECT 1 AS "value" FROM json_each(?) AS "entry"',
      },
    ])('preserves legacy function-source SQL $name', ({ source, sql }) => {
      const ast = SelectAst.from(source).withProjection([
        ProjectionItem.of('value', LiteralExpr.of(1)),
      ]);

      expect(adapter.lower(ast, { contract }).sql).toBe(sql);
    });

    it.each([
      {
        name: 'WITH ORDINALITY',
        source: FunctionSource.of('json_each', []).withOrdinality(),
        message: 'SQLite does not support WITH ORDINALITY on function sources',
        feature: 'function-source-with-ordinality',
      },
      {
        name: 'returned-column aliases',
        source: FunctionSource.of('json_each', [], {
          alias: 'entry',
          columnAliases: ['value'],
        }),
        message: 'SQLite does not support returned-column aliases on function sources',
        feature: 'function-source-column-aliases',
      },
    ])('rejects function sources with $name', ({ source, message, feature }) => {
      const ast = SelectAst.from(source).withProjection([
        ProjectionItem.of('value', LiteralExpr.of(1)),
      ]);

      expect(() => adapter.lower(ast, { contract })).toThrow(
        expect.objectContaining({
          name: 'StructuredError',
          code: 'RUNTIME.AST_UNSUPPORTED',
          message,
          meta: { target: 'sqlite', feature },
        }),
      );
    });

    it('renders subquery in projection', () => {
      const subquery = SelectAst.from(TableSource.named('post'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));

      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('firstPostId', SubqueryExpr.of(subquery)),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain(
        '(SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id") AS "firstPostId"',
      );
    });

    it('renders EXISTS and NOT EXISTS', () => {
      const subquery = SelectAst.from(TableSource.named('post'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));

      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(ExistsExpr.notExists(subquery));

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('NOT EXISTS (SELECT');
    });

    it('renders null checks', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          AndExpr.of([
            NullCheckExpr.isNull(ColumnRef.of('user', 'metadata')),
            NullCheckExpr.isNotNull(ColumnRef.of('user', 'email')),
          ]),
        );

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('"user"."metadata" IS NULL');
      expect(sql).toContain('"user"."email" IS NOT NULL');
    });

    it('renders empty IN as FALSE, empty NOT IN as TRUE', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          AndExpr.of([
            BinaryExpr.in(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
            BinaryExpr.notIn(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
          ]),
        );

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('FALSE');
      expect(sql).toContain('TRUE');
    });

    it('renders empty OR as FALSE', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(OrExpr.false());

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('WHERE FALSE');
    });
  });

  describe('INSERT', () => {
    it('renders insert with ? params', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        {
          id: ParamRef.of(1, { name: 'id' }),
          email: ParamRef.of('a@example.com', { name: 'email' }),
        },
      ]);

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.sql).toBe('INSERT INTO "user" ("id", "email") VALUES (?, ?)');
      expect(lowered.params).toEqual(litParams(1, 'a@example.com'));
    });

    it('renders multi-row insert', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        { id: ParamRef.of(1), email: ParamRef.of('a@example.com') },
        { id: ParamRef.of(2), email: ParamRef.of('b@example.com') },
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('INSERT INTO "user" ("id", "email") VALUES (?, ?), (?, ?)');
    });

    it('renders DEFAULT VALUES', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([{}]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('INSERT INTO "user" DEFAULT VALUES');
    });

    it('renders ON CONFLICT DO NOTHING', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doNothing());

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('ON CONFLICT ("email") DO NOTHING');
    });

    it('renders ON CONFLICT DO UPDATE SET', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withOnConflict(
          InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
            email: ColumnRef.of('excluded', 'email'),
          }),
        );

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"');
    });

    it('renders RETURNING', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('RETURNING "user"."id"');
    });

    it('renders RETURNING with `AS <alias>` when the projection alias differs from the column name', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withReturning([ProjectionItem.of('user_id', ColumnRef.of('user', 'id'))]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('RETURNING "user"."id" AS "user_id"');
    });

    it('throws on DEFAULT value in VALUES (unsupported by SQLite)', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        { id: ParamRef.of(1), email: new DefaultValueExpr() },
      ]);

      expect(() => adapter.lower(ast, { contract })).toThrow(
        'SQLite does not support DEFAULT as a value in INSERT ... VALUES',
      );
    });
  });

  describe('UPDATE', () => {
    it('renders update with WHERE and ? params', () => {
      const ast = UpdateAst.table(TableSource.named('user'))
        .withSet({ email: ParamRef.of('b@example.com') })
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)));

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.sql).toBe('UPDATE "user" SET "email" = ? WHERE "user"."id" = ?');
      expect(lowered.params).toEqual(litParams('b@example.com', 1));
    });

    it('renders update with RETURNING', () => {
      const ast = UpdateAst.table(TableSource.named('user'))
        .withSet({ email: ParamRef.of('b@example.com') })
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)))
        .withReturning([ProjectionItem.of('email', ColumnRef.of('user', 'email'))]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        'UPDATE "user" SET "email" = ? WHERE "user"."id" = ? RETURNING "user"."email"',
      );
    });
  });

  describe('DELETE', () => {
    it('renders delete with WHERE', () => {
      const ast = DeleteAst.from(TableSource.named('user')).withWhere(
        BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)),
      );

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.sql).toBe('DELETE FROM "user" WHERE "user"."id" = ?');
      expect(lowered.params).toEqual(litParams(1));
    });

    it('renders delete with RETURNING', () => {
      const ast = DeleteAst.from(TableSource.named('user'))
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)))
        .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe('DELETE FROM "user" WHERE "user"."id" = ? RETURNING "user"."id"');
    });
  });

  describe('JSON functions', () => {
    it('renders json_object instead of json_build_object', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of(
          'payload',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'email',
              new NativeJsonValueProjection(ColumnRef.of('user', 'email')),
            ),
            JsonObjectExpr.entry('count', new NativeJsonValueProjection(AggregateExpr.count())),
          ]),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('json_object(\'email\', "user"."email", \'count\', COUNT(*))');
    });

    function selectProjecting(projection: AnyJsonValueProjection): SelectAst {
      return SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of(
          'object',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', projection)]),
        ),
        ProjectionItem.of('array', JsonArrayAggExpr.of(projection)),
      ]);
    }

    it.each([
      {
        name: 'codec',
        projection: new CodecJsonValueProjection(ColumnRef.of('user', 'email'), {
          codecId: 'sqlite/text@1',
        }),
      },
      {
        name: 'native',
        projection: new NativeJsonValueProjection(ColumnRef.of('user', 'email')),
      },
    ])('renders $name JSON value projections as the column itself', ({ projection }) => {
      const { sql } = adapter.lower(selectProjecting(projection), { contract });

      expect(sql).toBe(
        `SELECT json_object('value', "user"."email") AS "object", json_group_array("user"."email") AS "array" FROM "user"`,
      );
    });

    // `sqlite/text@1` projects as itself, which is why the codec case above
    // matches native. A document does not: SQLite keeps "this text is JSON" as a
    // subtype that a derived table drops, so a document arriving from one is
    // plain text and has to be retagged before an enclosing constructor sees it.
    it('retags a document JSON value projection', () => {
      const projection = new JsonDocumentProjection(ColumnRef.of('user', 'email'));

      const { sql } = adapter.lower(selectProjecting(projection), { contract });

      expect(sql).toBe(
        `SELECT json_object('value', json("user"."email")) AS "object", json_group_array(json("user"."email")) AS "array" FROM "user"`,
      );
    });

    it('renders nested scalar projection expressions with exact precedence', () => {
      const decision = CaseExpr.of(
        [
          {
            condition: BinaryExpr.eq(
              FunctionCallExpr.of('lower', [ColumnRef.of('user', 'email')]),
              ParamRef.of('a@example.com'),
            ),
            value: CastExpr.as(
              FunctionCallExpr.of('concat', [ColumnRef.of('user', 'email'), ParamRef.of('!')]),
              'text',
            ),
          },
          {
            condition: NullCheckExpr.isNull(ColumnRef.of('user', 'metadata')),
            value: FunctionCallExpr.of('coalesce', [
              ColumnRef.of('user', 'email'),
              LiteralExpr.of('missing'),
            ]),
          },
        ],
        CastExpr.as(ParamRef.of('fallback'), 'text'),
      );
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('zero', FunctionCallExpr.of('random', [])),
        ProjectionItem.of('decision', NullCheckExpr.isNotNull(decision)),
      ]);

      const { sql } = adapter.lower(ast, { contract });

      expect(sql).toBe(
        `SELECT random() AS "zero", CASE WHEN lower("user"."email") = ? THEN CAST(concat("user"."email", ?) AS text) WHEN "user"."metadata" IS NULL THEN coalesce("user"."email", 'missing') ELSE CAST(? AS text) END IS NOT NULL AS "decision" FROM "user"`,
      );
    });

    it.each([
      {
        name: 'function call',
        expression: FunctionCallExpr.of('lower', [ColumnRef.of('user', 'email')]),
        sql: 'lower("user"."email")',
      },
      {
        name: 'cast',
        expression: CastExpr.as(ColumnRef.of('user', 'email'), 'text'),
        sql: 'CAST("user"."email" AS text)',
      },
      {
        name: 'searched CASE',
        expression: CaseExpr.of([
          {
            condition: BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1)),
            value: LiteralExpr.of('found'),
          },
        ]),
        sql: `CASE WHEN "user"."id" = 1 THEN 'found' END`,
      },
    ])('treats $name expressions as atomic under null checks', ({ expression, sql }) => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('value', NullCheckExpr.isNotNull(expression)),
      ]);

      expect(adapter.lower(ast, { contract }).sql).toBe(
        `SELECT ${sql} IS NOT NULL AS "value" FROM "user"`,
      );
    });

    it('renders json_group_array instead of json_agg', () => {
      const ast = SelectAst.from(TableSource.named('post')).withProjection([
        ProjectionItem.of(
          'posts',
          JsonArrayAggExpr.of(new NativeJsonValueProjection(ColumnRef.of('post', 'title'))),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('json_group_array("post"."title")');
    });

    it('renders coalesce with empty array literal for onEmpty', () => {
      const ast = SelectAst.from(TableSource.named('post')).withProjection([
        ProjectionItem.of(
          'posts',
          JsonArrayAggExpr.of(
            new NativeJsonValueProjection(ColumnRef.of('post', 'title')),
            'emptyArray',
          ),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('coalesce(json_group_array("post"."title"), \'[]\')');
    });
  });

  describe('literals', () => {
    it('renders string, number, boolean, null, date, and object literals', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('bigintValue', LiteralExpr.of(12n)),
        ProjectionItem.of('dateValue', LiteralExpr.of(new Date('2024-01-01T00:00:00.000Z'))),
        ProjectionItem.of('jsonValue', LiteralExpr.of({ ok: true })),
        ProjectionItem.of('missingValue', LiteralExpr.of(undefined)),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toBe(
        `SELECT 12 AS "bigintValue", '2024-01-01T00:00:00.000Z' AS "dateValue", '{"ok":true}' AS "jsonValue", NULL AS "missingValue" FROM "user"`,
      );
    });
  });

  describe('negative cases', () => {
    it('does not emit DISTINCT ON (Postgres-only)', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).not.toContain('DISTINCT ON');
    });

    it('does not emit LATERAL in joins', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).not.toContain('LATERAL');
    });

    it('does not emit ::type cast syntax', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          BinaryExpr.eq(
            ColumnRef.of('user', 'metadata'),
            ParamRef.of(
              { active: true },
              { name: 'metadata', codec: { codecId: 'sqlite/json@1' } },
            ),
          ),
        );

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).not.toContain('::');
      expect(sql).toContain('= ?');
    });

    it('throws on unsupported AST node kind', () => {
      const unsupported = {
        kind: 'unsupported',
        collectParamRefs: () => [],
        collectRefs: () => ({ tables: [], columns: [] }),
      } as unknown as AnyQueryAst;
      expect(() => adapter.lower(unsupported, { contract })).toThrow(
        'Unsupported AST node kind: unsupported',
      );
    });

    it('throws on empty insert rows', () => {
      expect(() =>
        adapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), { contract }),
      ).toThrow('INSERT requires at least one row');
    });
  });

  describe('joins', () => {
    it('renders INNER JOIN', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('user', 'id')),
          ProjectionItem.of('title', ColumnRef.of('post', 'title')),
        ])
        .withJoins([
          new JoinAst(
            'inner',
            TableSource.named('post'),
            BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')),
          ),
        ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('INNER JOIN "post" ON "post"."userId" = "user"."id"');
    });

    it('renders LEFT JOIN', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withJoins([
          new JoinAst(
            'left',
            TableSource.named('post'),
            BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')),
          ),
        ]);

      const { sql } = adapter.lower(ast, { contract });
      expect(sql).toContain('LEFT JOIN "post" ON');
    });
  });
});
