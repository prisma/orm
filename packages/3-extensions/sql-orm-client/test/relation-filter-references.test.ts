import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { and } from '../src/filters';
import { compileSelect } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';

const adapter = createPostgresAdapter();

function sqlOf(state: CollectionState): string {
  const plan = compileSelect(baseContract, state);
  return adapter.lower(plan.ast, {
    contract: baseContract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

describe('table references in relation filters', () => {
  it('renders two filters over one relation against separate references', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.select('id').where((user) =>
      and(
        user.posts.some((post) => post.views.gt(10)),
        user.posts.none((post) => post.views.gt(100)),
      ),
    ).state;

    expect(sqlOf(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" WHERE (EXISTS (SELECT "posts"."user_id" AS "_exists" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND "posts"."views" > $1)) AND NOT EXISTS (SELECT "posts_2"."user_id" AS "_exists" FROM "public"."posts" AS "posts_2" WHERE ("posts_2"."user_id" = "users"."id" AND "posts_2"."views" > $2)))"`,
    );
  });

  it('renders a self-relation filter nested in itself against separate references', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .where((user) =>
        user.invitedUsers.some((invited) =>
          invited.invitedUsers.some((nested) => nested.name.eq('Dan')),
        ),
      ).state;

    expect(sqlOf(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id" FROM "public"."users" WHERE EXISTS (SELECT "users_2"."invited_by_id" AS "_exists" FROM "public"."users" AS "users_2" WHERE ("users_2"."invited_by_id" = "users"."id" AND EXISTS (SELECT "users_3"."invited_by_id" AS "_exists" FROM "public"."users" AS "users_3" WHERE ("users_3"."invited_by_id" = "users_2"."id" AND "users_3"."name" = $1))))"`,
    );
  });
});
