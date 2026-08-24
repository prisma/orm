import type { PostgresContract } from '@internal/adapter-postgres/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  NativeJsonValueProjection,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../2-sql/9-family/test/test-sql-contract-serializer';
import pgvectorRuntime from '../src/exports/runtime';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                createdAt: {
                  codecId: 'pg/timestamptz-temporal@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                },
                vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                user_id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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
}) as PostgresContract;

describe('Postgres rich AST lowering', () => {
  // Compose a stack with pgvector so the renderer's codec lookup contains
  // `pg/vector@1`. Bare `createPostgresAdapter()` cannot see extension
  // codecs by design (ADR 205).
  const adapter = createComposedPostgresAdapter({ extensions: [pgvectorRuntime] });

  it('lowers selects with derived lateral joins and rich JSON expressions', () => {
    const childRows = SelectAst.from(TableSource.named('post'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('post', 'id')),
        ProjectionItem.of('title', ColumnRef.of('post', 'title')),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'user_id'), ColumnRef.of('user', 'id')))
      .withOrderBy([OrderByItem.asc(ColumnRef.of('post', 'title'))])
      .withLimit(2);

    const aggregateQuery = SelectAst.from(
      DerivedTableSource.as('post_rows', childRows),
    ).withProjection([
      ProjectionItem.of(
        'posts',
        JsonArrayAggExpr.of(
          new NativeJsonValueProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new NativeJsonValueProjection(ColumnRef.of('post_rows', 'id')),
              ),
              JsonObjectExpr.entry(
                'title',
                new NativeJsonValueProjection(ColumnRef.of('post_rows', 'title')),
              ),
            ]),
          ),
          'emptyArray',
          [OrderByItem.asc(ColumnRef.of('post_rows', 'title'))],
        ),
      ),
    ]);

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('posts', ColumnRef.of('posts_lateral', 'posts')),
      ])
      .withJoins([
        JoinAst.left(DerivedTableSource.as('posts_lateral', aggregateQuery), AndExpr.true(), true),
      ])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'userId', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withOrderBy([OrderByItem.desc(ColumnRef.of('user', 'createdAt'))])
      .withLimit(10)
      .withOffset(5);

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.sql).toContain('LEFT JOIN LATERAL');
    expect(lowered.sql).toContain('json_agg(json_build_object');
    expect(lowered.sql).toContain('ORDER BY "post_rows"."title" ASC');
    expect(lowered.sql).toContain('LIMIT 10 OFFSET 5');
    expect(lowered.sql).toContain('WHERE "user"."id" = $1');
  });

  it('lowers typed operations and casts vector parameters', () => {
    const distance = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('user', 'vector'),
      args: [
        ParamRef.of([1, 2, 3], {
          name: 'other',
          codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
        }),
      ],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
    });

    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('distance', distance),
      ProjectionItem.of('count', AggregateExpr.count()),
    ]);

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.sql).toContain('"user"."vector" <=> $1::vector');
    expect(lowered.sql).toContain('COUNT(*) AS "count"');
  });

  it('lowers scalar subquery expressions in projections', () => {
    const subquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('cnt', AggregateExpr.count())])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'user_id'), ColumnRef.of('user', 'id')));

    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('post_count', SubqueryExpr.of(subquery)),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toContain(
      '(SELECT COUNT(*) AS "cnt" FROM "post" WHERE "post"."user_id" = "user"."id") AS "post_count"',
    );
  });

  it('lowers insert, update, and delete statements built from rich nodes', () => {
    const insertAst = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        },
        {
          id: ParamRef.of(2, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('email', ColumnRef.of('user', 'email')),
      ]);

    const insertSql = adapter.lower(insertAst, { contract }).sql;
    expect(insertSql).toContain(
      'INSERT INTO "user" ("id", "email") VALUES ($1, $2), ($3, DEFAULT)',
    );
    expect(insertSql).toContain('ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"');
    expect(insertSql).toContain('RETURNING "user"."id", "user"."email"');

    const updateAst = UpdateAst.table(TableSource.named('user'))
      .withSet({
        email: ParamRef.of('b@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
      })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    const updateSql = adapter.lower(updateAst, { contract }).sql;
    expect(updateSql).toBe(
      'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."id"',
    );

    const deleteAst = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    const deleteSql = adapter.lower(deleteAst, { contract }).sql;
    expect(deleteSql).toBe('DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id"');
  });

  it('renders RETURNING with `AS <alias>` when the projection alias differs from the column name', () => {
    const adapter = createComposedPostgresAdapter({ extensions: [pgvectorRuntime] });
    const insertAst = InsertAst.into(TableSource.named('user'))
      .withRows([{ id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }) }])
      .withReturning([ProjectionItem.of('user_id', ColumnRef.of('user', 'id'))]);

    const sql = adapter.lower(insertAst, { contract }).sql;
    expect(sql).toContain('RETURNING "user"."id" AS "user_id"');
  });
});
