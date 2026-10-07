import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

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
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                email: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                userId: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                title: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            comment: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                postId: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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

describe('Postgres adapter join rendering', () => {
  const adapter = createPostgresAdapter();

  function selectWithJoin(join: JoinAst): SelectAst {
    return SelectAst.from(TableSource.named('user'))
      .withJoins([join])
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('title', ColumnRef.of('post', 'title')),
      ]);
  }

  it.each([
    [
      'inner',
      JoinAst.inner(
        TableSource.named('post'),
        EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
      ),
    ],
    [
      'left',
      JoinAst.left(
        TableSource.named('post'),
        EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
      ),
    ],
    [
      'right',
      JoinAst.right(
        TableSource.named('post'),
        EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
      ),
    ],
    [
      'full',
      JoinAst.full(
        TableSource.named('post'),
        EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
      ),
    ],
  ] as const)('renders %s joins correctly', (joinType, join) => {
    const lowered = adapter.lower(selectWithJoin(join), { contract, params: [] });
    expect(lowered.sql).toContain(`${joinType.toUpperCase()} JOIN "post"`);
    expect(lowered.sql).toContain('"user"."id" = "post"."userId"');
  });

  it('renders multiple chained joins and WHERE predicates', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('post'),
          EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
        ),
        JoinAst.left(
          TableSource.named('comment'),
          EqColJoinOn.of(ColumnRef.of('post', 'id'), ColumnRef.of('comment', 'postId')),
        ),
      ])
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ColumnRef.of('post', 'title')));

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toContain('INNER JOIN "post"');
    expect(lowered.sql).toContain('LEFT JOIN "comment"');
    expect(lowered.sql).toContain('WHERE "user"."email" = "post"."title"');
  });

  it('renders lateral derived-table joins', () => {
    const lateralRows = SelectAst.from(TableSource.named('post')).withProjection([
      ProjectionItem.of('userId', ColumnRef.of('post', 'userId')),
    ]);
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withJoins([
        JoinAst.left(DerivedTableSource.as('post_rows', lateralRows), AndExpr.true(), true),
      ]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toContain('LEFT JOIN LATERAL');
    expect(lowered.sql).toContain(
      '(SELECT "post"."userId" AS "userId" FROM "post") AS "post_rows"',
    );
  });
});
