import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  JoinAst,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { createModelAccessor } from '../src/model-accessor';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan-aggregate';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { getEmptyAggregates, getTestAggregates, getTestContext } from './helpers';

const adapter = createPostgresAdapter();

function planOf(tableName: string, state: CollectionState): SqlQueryPlan<unknown> {
  return compileSelect(baseContract, 'public', tableName, state);
}

function sqlOf(plan: SqlQueryPlan<unknown>): string {
  return adapter.lower(plan.ast, {
    contract: baseContract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

function orderByOf(plan: SqlQueryPlan<unknown>): ReadonlyArray<OrderByItem> | undefined {
  return (plan.ast as SelectAst).orderBy;
}

function table(name: string, alias?: string): TableSource {
  return TableSource.named(name, alias, 'public');
}

function correlated(
  from: TableSource,
  projection: ProjectionItem,
  where: AnyExpression,
): SubqueryExpr {
  return SubqueryExpr.of(SelectAst.from(from).withProjection([projection]).withWhere(where));
}

describe('orderBy through a to-one relation', () => {
  it('orders by the related column through a correlated scalar subquery', () => {
    const { collection } = createCollectionFor('Post');
    const plan = planOf(
      'posts',
      collection.orderBy([(post) => post.author.name.asc(), (post) => post.id.asc()]).select('id')
        .state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.asc(
        correlated(
          table('users'),
          ProjectionItem.of('name', ColumnRef.of('users', 'name')),
          BinaryExpr.eq(ColumnRef.of('users', 'id'), ColumnRef.of('posts', 'user_id')),
        ),
      ),
      OrderByItem.asc(ColumnRef.of('posts', 'id')),
    ]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "posts"."id" AS "id" FROM "public"."posts" ORDER BY (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") ASC, "posts"."id" ASC"`,
    );
  });

  it('aliases the inner table of a self-relation so the correlation is unambiguous', () => {
    const { collection } = createCollectionFor('User');
    const plan = planOf(
      'users',
      collection.orderBy((user) => user.invitedBy.name.desc({ nulls: 'last' })).select('id').state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.desc(
        correlated(
          table('users', '__orm_rel_1'),
          ProjectionItem.of('name', ColumnRef.of('__orm_rel_1', 'name')),
          BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'id'), ColumnRef.of('users', 'invited_by_id')),
        ),
        { nulls: 'last' },
      ),
    ]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT "__orm_rel_1"."name" AS "name" FROM "public"."users" AS "__orm_rel_1" WHERE "__orm_rel_1"."id" = "users"."invited_by_id") DESC NULLS LAST"`,
    );
  });
});

describe('a to-one relation accessor', () => {
  function countingContext() {
    const base = getTestContext();
    const descriptorFor = vi.fn((codecId: string) => base.codecDescriptors.descriptorFor(codecId));
    const context = {
      ...base,
      codecDescriptors: { ...base.codecDescriptors, descriptorFor },
    };
    return { context, descriptorFor };
  }

  it('resolves no related field when only a relation filter is used', () => {
    const { context, descriptorFor } = countingContext();
    const post = createModelAccessor(context, 'public', 'Post');

    post.author.some();

    expect(descriptorFor).not.toHaveBeenCalled();
  });

  it('resolves only the related field that is read', () => {
    const { context, descriptorFor } = countingContext();
    const post = createModelAccessor(context, 'public', 'Post');

    post.author.name.asc();

    expect(descriptorFor.mock.calls).toEqual([['pg/text@1']]);
  });

  it('yields nothing for a name that is not a related field', () => {
    const post = createModelAccessor(getTestContext(), 'public', 'Post');

    expect([Reflect.get(post.author, 'toString'), Reflect.get(post.author, 'constructor')]).toEqual(
      [undefined, undefined],
    );
  });

  it('offers no count', () => {
    const post = createModelAccessor(getTestContext(), 'public', 'Post');

    expect(Object.hasOwn(post.author, 'count')).toBe(false);
    expect(Reflect.get(post.author, 'count')).toBeUndefined();
  });
});

describe('orderBy a to-many relation count', () => {
  it('orders by a correlated count of the related rows', () => {
    const { collection } = createCollectionFor('User');
    const plan = planOf(
      'users',
      collection.orderBy((user) => user.posts.count().desc()).select('id').state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.desc(
        correlated(
          table('posts'),
          ProjectionItem.of('count', AggregateExpr.count()),
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        ),
      ),
    ]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."posts" WHERE "posts"."user_id" = "users"."id") DESC"`,
    );
  });

  it('counts only the related rows matching the predicate, bound like some()', () => {
    const { collection } = createCollectionFor('User');
    const plan = planOf(
      'users',
      collection
        .orderBy((user) => user.posts.count((post) => post.views.gt(10)).desc())
        .select('id').state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.desc(
        correlated(
          table('posts'),
          ProjectionItem.of('count', AggregateExpr.count()),
          AndExpr.of([
            BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
            BinaryExpr.gt(
              ColumnRef.of('posts', 'views'),
              ParamRef.of(10, {
                codec: codecRefForStorageColumn(baseContract.storage, 'public', 'posts', 'views')!,
              }),
            ),
          ]),
        ),
      ),
    ]);
    expect(plan.params).toEqual([10]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND "posts"."views" > $1)) DESC"`,
    );
  });

  it('numbers the count predicate parameter after the WHERE parameters', () => {
    const { collection } = createCollectionFor('User');
    const plan = planOf(
      'users',
      collection
        .where((user) => user.name.eq('a'))
        .orderBy((user) => user.posts.count((post) => post.views.gt(10)).desc())
        .select('id').state,
    );

    expect(plan.params).toEqual(['a', 10]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" WHERE "users"."name" = $1 ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND "posts"."views" > $2)) DESC"`,
    );
  });

  it('offers count whatever the target declares for projected counts', () => {
    const context = { ...getTestContext(), aggregateDescriptors: getEmptyAggregates() };
    const user = createModelAccessor(context, 'public', 'User');

    expect(user.posts.count().desc()).toEqual(
      OrderByItem.desc(
        correlated(
          table('posts'),
          ProjectionItem.of('count', AggregateExpr.count()),
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        ),
      ),
    );
  });

  it('counts an N:M relation through the junction table', () => {
    const { collection } = createCollectionFor('User');
    const plan = planOf(
      'users',
      collection.orderBy((user) => user.tags.count().asc()).select('id').state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.asc(
        SubqueryExpr.of(
          SelectAst.from(table('tags'))
            .withJoins([
              JoinAst.inner(
                table('user_tags'),
                BinaryExpr.eq(ColumnRef.of('user_tags', 'tag_id'), ColumnRef.of('tags', 'id')),
              ),
            ])
            .withProjection([ProjectionItem.of('count', AggregateExpr.count())])
            .withWhere(
              BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
            ),
        ),
      ),
    ]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."tags" INNER JOIN "public"."user_tags" ON "user_tags"."tag_id" = "tags"."id" WHERE "user_tags"."user_id" = "users"."id") ASC"`,
    );
  });
});

describe('orderBy null placement on a scalar field', () => {
  it('renders NULLS LAST after the direction', () => {
    const { collection } = createCollectionFor('Post');
    const plan = planOf(
      'posts',
      collection.orderBy((post) => post.title.desc({ nulls: 'last' })).select('id').state,
    );

    expect(orderByOf(plan)).toEqual([
      OrderByItem.desc(ColumnRef.of('posts', 'title'), { nulls: 'last' }),
    ]);
    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "posts"."id" AS "id" FROM "public"."posts" ORDER BY "posts"."title" DESC NULLS LAST"`,
    );
  });
});

describe('orderBy a relation inside an include', () => {
  it('correlates the subquery with the included child rows', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts.select('id').orderBy((post) => post.comments.count().desc()),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."address" AS "address", "users"."email" AS "email", "users"."id" AS "id", "users"."invited_by_id" AS "invited_by_id", "users"."name" AS "name", (SELECT coalesce(json_agg(json_build_object('id', "posts__rows"."id") ORDER BY "posts__rows"."posts__order_0" DESC), json_build_array()) AS "posts" FROM (SELECT "posts"."id" AS "id", (SELECT COUNT(*) AS "count" FROM "public"."comments" WHERE "comments"."post_id" = "posts"."id") AS "posts__order_0" FROM "public"."posts" WHERE "posts"."user_id" = "users"."id" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."comments" WHERE "comments"."post_id" = "posts"."id") DESC) AS "posts__rows") AS "posts" FROM "public"."users""`,
    );
  });

  it('correlates a self-relation order with the aliased child rows', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('invitedUsers', (invited) =>
      invited.select('id').orderBy((user) => user.invitedBy.name.asc()),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "users"."address" AS "address", "users"."email" AS "email", "users"."id" AS "id", "users"."invited_by_id" AS "invited_by_id", "users"."name" AS "name", (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id") ORDER BY "invitedUsers__rows"."invitedUsers__order_0" ASC), json_build_array()) AS "invitedUsers" FROM (SELECT "invitedUsers__child"."id" AS "id", (SELECT "__orm_rel_1"."name" AS "name" FROM "public"."users" AS "__orm_rel_1" WHERE "__orm_rel_1"."id" = "invitedUsers__child"."invited_by_id") AS "invitedUsers__order_0" FROM "public"."users" AS "invitedUsers__child" WHERE "invitedUsers__child"."invited_by_id" = "users"."id" ORDER BY (SELECT "__orm_rel_1"."name" AS "name" FROM "public"."users" AS "__orm_rel_1" WHERE "__orm_rel_1"."id" = "invitedUsers__child"."invited_by_id") ASC) AS "invitedUsers__rows") AS "invitedUsers" FROM "public"."users""`,
    );
  });
});

describe('orderBy a relation under a paginated aggregate', () => {
  it('orders the aggregate input rows by the correlated subquery', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection.orderBy((post) => post.author.name.asc()).limit(2).state;

    const plan = compileAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      state,
      { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
      'Post',
    );

    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT SUM("posts"."views") AS "totalViews" FROM (SELECT "posts"."views" AS "views" FROM "public"."posts" ORDER BY (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") ASC LIMIT 2) AS "posts""`,
    );
  });
});

describe('orderBy a relation under an aggregate over distinct rows', () => {
  it('carries the relation order through the dedup wrap as a hidden column', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy((post) => post.author.name.asc({ nulls: 'last' }))
      .distinct('title')
      .limit(2).state;

    const plan = compileAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      state,
      { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
      'Post',
    );

    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT SUM("posts"."views") AS "totalViews" FROM (SELECT "posts"."views" AS "views" FROM (SELECT "posts"."views" AS "views", (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") AS "__order_0", ROW_NUMBER() OVER (PARTITION BY "posts"."title" ORDER BY (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") ASC NULLS LAST) AS "__prisma_distinct_rn" FROM "public"."posts") AS "posts" WHERE "posts"."__prisma_distinct_rn" = 1 ORDER BY "posts"."__order_0" ASC NULLS LAST LIMIT 2) AS "posts""`,
    );
  });

  it('carries the relation order through the dedup wrap under groupBy', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection.orderBy((post) => post.author.name.asc()).distinct('title').state;

    const plan = compileGroupedAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      state,
      ['user_id'],
      { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
      undefined,
      'Post',
    );

    expect(sqlOf(plan)).toMatchInlineSnapshot(
      `"SELECT "posts"."user_id" AS "user_id", SUM("posts"."views") AS "totalViews" FROM (SELECT "posts"."user_id" AS "user_id", "posts"."views" AS "views" FROM (SELECT "posts"."user_id" AS "user_id", "posts"."views" AS "views", (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") AS "__order_0", ROW_NUMBER() OVER (PARTITION BY "posts"."title" ORDER BY (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") ASC) AS "__prisma_distinct_rn" FROM "public"."posts") AS "posts" WHERE "posts"."__prisma_distinct_rn" = 1 ORDER BY "posts"."__order_0" ASC) AS "posts" GROUP BY "posts"."user_id""`,
    );
  });
});
