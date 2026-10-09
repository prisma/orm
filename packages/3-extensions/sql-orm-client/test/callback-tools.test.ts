import { createPostgresAdapter, postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { Collection } from '../src/collection';
import { and, not } from '../src/filters';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { createMockRuntime, getTestAggregates, getTestContext } from './helpers';

const adapter = createPostgresAdapter();

function sqlOf(plan: SqlQueryPlan<unknown>): string {
  return adapter.lower(plan.ast, {
    contract: baseContract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

function usersSql(state: CollectionState): string {
  return sqlOf(compileSelect(baseContract, 'public', 'User', 'users', state));
}

function usersSqlWithIncludes(state: CollectionState): string {
  return sqlOf(
    compileSelectWithIncludes(baseContract, getTestAggregates(), 'public', 'User', 'users', state),
  );
}

const searchOf = (table: string) =>
  `(setweight(to_tsvector('english', coalesce("${table}"."name", '')), 'A') || setweight(to_tsvector('english', coalesce("${table}"."email", '')), 'B'))`;

const q = websearchToTsquery('alice');

describe('where with fns and indexes', () => {
  it('searches the document the index was built over', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q));

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${searchOf('users')} @@ websearch_to_tsquery('english', $1)`,
    );
  });

  it('combines a condition from fns with ORM conditions', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .where((u, { fns, indexes }) =>
        and(u.name.eq('Alice'), not(fns.fullTextMatches(indexes.users_search, q))),
      );

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ("users"."name" = $1 AND NOT (${searchOf('users')} @@ websearch_to_tsquery('english', $2)))`,
    );
  });

  it('binds the index to the alias of a related table in a relation filter', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .where((u) =>
        u.invitedUsers.some((_invited, { fns, indexes }) =>
          fns.fullTextMatches(indexes.users_search, q),
        ),
      );

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE EXISTS (SELECT "__orm_rel_1"."invited_by_id" AS "_exists" FROM "public"."users" AS "__orm_rel_1" WHERE ("__orm_rel_1"."invited_by_id" = "users"."id" AND ${searchOf('__orm_rel_1')} @@ websearch_to_tsquery('english', $1)))`,
    );
  });

  it('binds the index to the alias of a related table in an include refinement', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .include('invitedUsers', (invited) =>
        invited
          .select('id')
          .where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
      );

    expect(usersSqlWithIncludes(users.state)).toContain(
      `${searchOf('invitedUsers__child')} @@ websearch_to_tsquery('english', $1)`,
    );
  });
});

describe('orderBy with fns and indexes', () => {
  it('orders by a value from fns', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .orderBy([
        (_u, { fns, indexes }) => fns.fullTextRank(indexes.users_search, q).desc(),
        (u) => u.id.asc(),
      ]);

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY ts_rank(${searchOf('users')}, websearch_to_tsquery('english', $1)) DESC, "users"."id" ASC`,
    );
  });
});

describe('the callback tools', () => {
  it('give a value from fns asc and desc, and a condition neither', () => {
    const { collection } = createCollectionFor('User');
    let tools: { rank: object; matches: object } | undefined;

    collection.where((_u, { fns, indexes }) => {
      const matches = fns.fullTextMatches(indexes.users_search, q);
      tools = { rank: fns.fullTextRank(indexes.users_search, q), matches };
      return matches;
    });

    expect({
      rankOrders: tools !== undefined && 'asc' in tools.rank && 'desc' in tools.rank,
      matchesOrders: tools !== undefined && ('asc' in tools.matches || 'desc' in tools.matches),
    }).toEqual({ rankOrders: true, matchesOrders: false });
  });

  it('read the indexes once', () => {
    const { collection } = createCollectionFor('User');
    let reads: readonly unknown[] = [];

    collection.where((u, tools) => {
      reads = [tools.indexes, tools.indexes];
      return u.id.eq(1);
    });

    expect(reads[0]).toBe(reads[1]);
  });

  it('bind a bare value in fns.raw through the raw codec inferer the client was given', () => {
    const collection = new Collection(
      {
        runtime: createMockRuntime(),
        context: getTestContext(),
        rawCodecInferer: postgresRawCodecInferer,
      },
      'User',
      { namespaceId: 'public' },
    );

    const users = collection
      .select('id')
      .where((u, { fns }) => fns.eq(u.id, fns.raw`${1}`.returns('pg/int4@1')));

    expect(usersSql(users.state)).toBe(
      'SELECT "users"."id" AS "id" FROM "public"."users" WHERE "users"."id" = $1',
    );
  });

  it('refuse a bare value in fns.raw without a raw codec inferer', () => {
    const { collection } = createCollectionFor('User');

    expect(() =>
      collection.where((u, { fns }) => fns.eq(u.id, fns.raw`${1}`.returns('pg/int4@1'))),
    ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
  });
});
