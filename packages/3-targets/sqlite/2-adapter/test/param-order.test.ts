import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  FunctionCallExpr,
  FunctionSource,
  JoinAst,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  RawExpr,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { litParams } from '@repo/test-utils/lowered-params';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

const post = (column: string) => ColumnRef.of('post', column);
const user = (column: string) => ColumnRef.of('user', column);
const textReturn = { codecId: 'sqlite/text@1', nullable: false } as const;

function lower(ast: AnyQueryAst) {
  return renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);
}

const joinConditionAndWhere = SelectAst.from(TableSource.named('post'))
  .withProjection([ProjectionItem.of('title', post('title'))])
  .withJoins([
    JoinAst.inner(
      TableSource.named('user'),
      AndExpr.of([
        BinaryExpr.eq(post('userId'), user('id')),
        BinaryExpr.eq(user('email'), ParamRef.of('a@x')),
      ]),
    ),
  ])
  .withWhere(BinaryExpr.gt(post('views'), ParamRef.of(5)));

const derivedJoinSourceAndWhere = SelectAst.from(TableSource.named('user'))
  .withProjection([
    ProjectionItem.of('email', user('email')),
    ProjectionItem.of('title', ColumnRef.of('popular', 'title')),
  ])
  .withJoins([
    JoinAst.inner(
      DerivedTableSource.as(
        'popular',
        SelectAst.from(TableSource.named('post'))
          .withProjection([
            ProjectionItem.of('userId', post('userId')),
            ProjectionItem.of('title', post('title')),
          ])
          .withWhere(BinaryExpr.gt(post('views'), ParamRef.of(5))),
      ),
      BinaryExpr.eq(user('id'), ColumnRef.of('popular', 'userId')),
    ),
  ])
  .withWhere(BinaryExpr.eq(user('email'), ParamRef.of('a@x')));

const groupByAndHaving = SelectAst.from(TableSource.named('post'))
  .withProjection([
    ProjectionItem.of('popular', BinaryExpr.gt(post('views'), ParamRef.of(5))),
    ProjectionItem.of('total', AggregateExpr.count()),
  ])
  .withGroupBy([BinaryExpr.gt(post('views'), ParamRef.of(5))])
  .withHaving(BinaryExpr.gt(AggregateExpr.count(), ParamRef.of(1)));

const groupByAndOrderBy = SelectAst.from(TableSource.named('post'))
  .withProjection([ProjectionItem.of('total', AggregateExpr.count())])
  .withGroupBy([BinaryExpr.eq(post('userId'), ParamRef.of(1))])
  .withOrderBy([OrderByItem.desc(BinaryExpr.eq(AggregateExpr.count(), ParamRef.of(2)))]);

const derivedFromAndProjection = SelectAst.from(
  DerivedTableSource.as(
    'p',
    SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('title', post('title'))])
      .withWhere(BinaryExpr.eq(post('userId'), ParamRef.of(1))),
  ),
)
  .withProjection([
    ProjectionItem.of(
      'quiet',
      SubqueryExpr.of(
        SelectAst.from(TableSource.named('post', 'c'))
          .withProjection([ProjectionItem.of('n', AggregateExpr.count())])
          .withWhere(BinaryExpr.lt(ColumnRef.of('c', 'views'), ParamRef.of(5))),
      ),
    ),
    ProjectionItem.of('title', ColumnRef.of('p', 'title')),
  ])
  .withOrderBy([OrderByItem.asc(ColumnRef.of('p', 'title'))]);

const functionSourceAndProjection = SelectAst.from(
  FunctionSource.of('json_each', [ParamRef.of('["a","b"]')], { alias: 'j' }),
).withProjection([
  ProjectionItem.of(
    'v',
    FunctionCallExpr.of('concat', [ParamRef.of('x-'), ColumnRef.of('j', 'value')]),
  ),
]);

const prefixed = ParamRef.of('p');
const operationArgumentBeforeSelf = SelectAst.from(TableSource.named('post'))
  .withProjection([ProjectionItem.of('title', post('title'))])
  .withWhere(
    new OperationExpr({
      method: 'startsWith',
      self: FunctionCallExpr.of('concat', [ParamRef.of('p'), post('title')]),
      args: [ParamRef.of('pp')],
      returns: textReturn,
      lowering: { targetFamily: 'sql', template: '{{arg0}} = substr({{self}}, 1, 2)' },
    }),
  )
  .withOrderBy([OrderByItem.asc(post('title'))]);

const repeatedParam = SelectAst.from(TableSource.named('post'))
  .withProjection([ProjectionItem.of('title', post('title'))])
  .withWhere(
    AndExpr.of([
      BinaryExpr.eq(
        FunctionCallExpr.of('substr', [post('title'), ParamRef.of(1), ParamRef.of(1)]),
        prefixed,
      ),
      BinaryExpr.neq(post('title'), prefixed),
    ]),
  );

describe('SQLite parameter numbering', () => {
  it.each([
    {
      name: 'a join condition parameter and a where parameter',
      ast: joinConditionAndWhere,
      sql: 'SELECT "post"."title" AS "title" FROM "post" INNER JOIN "user" ON ("post"."userId" = "user"."id" AND "user"."email" = ?2) WHERE "post"."views" > ?1',
      params: [5, 'a@x'],
    },
    {
      name: 'a derived join source parameter and a where parameter',
      ast: derivedJoinSourceAndWhere,
      sql: 'SELECT "user"."email" AS "email", "popular"."title" AS "title" FROM "user" INNER JOIN (SELECT "post"."userId" AS "userId", "post"."title" AS "title" FROM "post" WHERE "post"."views" > ?2) AS "popular" ON "user"."id" = "popular"."userId" WHERE "user"."email" = ?1',
      params: ['a@x', 5],
    },
    {
      name: 'a group by parameter and a having parameter',
      ast: groupByAndHaving,
      sql: 'SELECT "post"."views" > ?1 AS "popular", COUNT(*) AS "total" FROM "post" GROUP BY "post"."views" > ?3 HAVING COUNT(*) > ?2',
      params: [5, 1, 5],
    },
    {
      name: 'a group by parameter and an order by parameter',
      ast: groupByAndOrderBy,
      sql: 'SELECT COUNT(*) AS "total" FROM "post" GROUP BY "post"."userId" = ?2 ORDER BY COUNT(*) = ?1 DESC',
      params: [2, 1],
    },
    {
      name: 'a derived from source parameter and a projection parameter',
      ast: derivedFromAndProjection,
      sql: 'SELECT (SELECT COUNT(*) AS "n" FROM "post" AS "c" WHERE "c"."views" < ?2) AS "quiet", "p"."title" AS "title" FROM (SELECT "post"."title" AS "title" FROM "post" WHERE "post"."userId" = ?1) AS "p" ORDER BY "p"."title" ASC',
      params: [1, 5],
    },
    {
      name: 'a function source argument and a projection parameter',
      ast: functionSourceAndProjection,
      sql: 'SELECT concat(?2, "j"."value") AS "v" FROM json_each(?1) AS "j"',
      params: ['["a","b"]', 'x-'],
    },
    {
      name: 'an operation template that writes its argument after its receiver',
      ast: operationArgumentBeforeSelf,
      sql: 'SELECT "post"."title" AS "title" FROM "post" WHERE ?2 = substr(concat(?1, "post"."title"), 1, 2) ORDER BY "post"."title" ASC',
      params: ['p', 'pp'],
    },
    {
      name: 'one parameter written twice',
      ast: repeatedParam,
      sql: 'SELECT "post"."title" AS "title" FROM "post" WHERE (substr("post"."title", ?1, ?2) = ?3 AND "post"."title" != ?3)',
      params: [1, 1, 'p'],
    },
  ])('lowers $name', ({ ast, sql, params }) => {
    expect(lower(ast)).toEqual({ sql, params: litParams(...params) });
  });
});

describe('SQLite parameter numbering, run against SQLite', () => {
  let database: DatabaseSync;

  beforeAll(() => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE post (id INTEGER PRIMARY KEY, "userId" INTEGER NOT NULL, title TEXT NOT NULL, views INTEGER NOT NULL);
      INSERT INTO "user" VALUES (1, 'a@x'), (2, 'b@x');
      INSERT INTO post VALUES (1, 1, 'p1', 10), (2, 1, 'p2', 1), (3, 2, 'p3', 10);
    `);
  });

  afterAll(() => {
    database.close();
  });

  function run(ast: AnyQueryAst): unknown[] {
    const { sql, params } = lower(ast);
    const values = params.map((param) =>
      param.kind === 'literal' ? (param.value as SQLInputValue) : null,
    );
    return database
      .prepare(sql)
      .all(...values)
      .map((row) => ({ ...row }));
  }

  it.each([
    {
      name: 'a join condition parameter and a where parameter',
      ast: joinConditionAndWhere,
      rows: [{ title: 'p1' }],
    },
    {
      name: 'a derived join source parameter and a where parameter',
      ast: derivedJoinSourceAndWhere,
      rows: [{ email: 'a@x', title: 'p1' }],
    },
    {
      name: 'a group by parameter and a having parameter',
      ast: groupByAndHaving,
      rows: [{ popular: 1, total: 2 }],
    },
    {
      name: 'a group by parameter and an order by parameter',
      ast: groupByAndOrderBy,
      rows: [{ total: 2 }, { total: 1 }],
    },
    {
      name: 'a derived from source parameter and a projection parameter',
      ast: derivedFromAndProjection,
      rows: [
        { quiet: 1, title: 'p1' },
        { quiet: 1, title: 'p2' },
      ],
    },
    {
      name: 'a function source argument and a projection parameter',
      ast: functionSourceAndProjection,
      rows: [{ v: 'x-a' }, { v: 'x-b' }],
    },
    {
      name: 'an operation template that writes its argument after its receiver',
      ast: operationArgumentBeforeSelf,
      rows: [{ title: 'p1' }, { title: 'p2' }, { title: 'p3' }],
    },
    {
      name: 'one parameter written twice',
      ast: repeatedParam,
      rows: [{ title: 'p1' }, { title: 'p2' }, { title: 'p3' }],
    },
  ])('returns the rows for $name', ({ ast, rows }) => {
    expect(run(ast)).toEqual(rows);
  });
});

describe('SQLite placeholder check', () => {
  const selectWhere = (where: RawExpr) =>
    SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('title', post('title'))])
      .withWhere(where);

  it('rejects a placeholder written in raw SQL text', () => {
    const ast = selectWhere(
      new RawExpr({
        parts: ['"post"."title" = ? AND "post"."views" > ', ParamRef.of(5)],
        returns: textReturn,
      }),
    );

    expect(() => lower(ast)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        meta: { placeholderCount: 2, paramCount: 1, firstPlaceholders: ['?', '?1'] },
      }),
    );
  });

  it('rejects a parameter no placeholder binds', () => {
    const ast = selectWhere(
      new RawExpr({
        parts: ['"post"."views" > ', ParamRef.of(5), ' -- ', ParamRef.of(6)],
        returns: textReturn,
      }),
    );

    expect(() => lower(ast)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        meta: { placeholderCount: 1, paramCount: 2, firstPlaceholders: ['?1'] },
      }),
    );
  });

  it('reports counts and only the first placeholders of a long mismatch', () => {
    const ast = selectWhere(
      new RawExpr({
        parts: ['"post"."views" IN (?, ?, ?, ?, ?, ?, ?, ?) AND "post"."views" > ', ParamRef.of(5)],
        returns: textReturn,
      }),
    );

    expect(() => lower(ast)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        message:
          'The lowered SQLite statement writes 9 placeholders for 1 parameter, starting ?, ?, ?, ?, ?; each parameter must be written as its own numbered placeholder, and no other placeholder may appear.',
        meta: { placeholderCount: 9, paramCount: 1, firstPlaceholders: ['?', '?', '?', '?', '?'] },
      }),
    );
  });

  it('ignores a question mark inside quoted text, a quoted identifier or a comment', () => {
    const ast = selectWhere(
      new RawExpr({
        parts: [
          `"post"."title" != 'it''s ?' AND "post"."title" != "a""?" AND [?] IS NOT \`?\` /* ? */ -- ?\nAND "post"."views" > `,
          ParamRef.of(5),
        ],
        returns: textReturn,
      }),
    );

    expect(lower(ast).params).toEqual(litParams(5));
  });
});
