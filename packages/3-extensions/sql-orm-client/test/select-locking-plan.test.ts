import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { soleDomainNamespaceId } from '@internal/contract/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { Collection } from '../src/collection';
import { baseContract, createCollectionFor } from './collection-fixtures';
import {
  buildMixedPolyContract,
  createMockRuntime,
  getTestContext,
  type MockRuntime,
} from './helpers';

const adapter = createPostgresAdapter();

function sqlOf(runtime: MockRuntime, contract = baseContract): string {
  const plan = runtime.executions[0]!.plan as SqlQueryPlan<unknown>;
  return adapter.lower(plan.ast, {
    contract: contract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

const postsSql =
  'SELECT "posts"."embedding" AS "embedding", "posts"."id" AS "id", "posts"."title" AS "title", "posts"."user_id" AS "user_id", "posts"."views" AS "views" FROM "public"."posts"';

const lockIncompatible = (conflict: string) =>
  expect.objectContaining({
    name: 'StructuredError',
    code: 'ORM.LOCK_INCOMPATIBLE',
    meta: { conflict },
  });

describe('ORM row locking, rendered SQL', () => {
  it.each([
    ['forUpdate', 'FOR UPDATE'],
    ['forNoKeyUpdate', 'FOR NO KEY UPDATE'],
    ['forShare', 'FOR SHARE'],
    ['forKeyShare', 'FOR KEY SHARE'],
  ] as const)('%s renders %s OF the model table', async (method, keyword) => {
    const { collection, runtime } = createCollectionFor('Post');

    await collection[method]().all().toArray();

    expect(sqlOf(runtime)).toBe(`${postsSql} ${keyword} OF "posts"`);
  });

  it('nowait and skipLocked render', async () => {
    const nowait = createCollectionFor('Post');
    const skipLocked = createCollectionFor('Post');

    await nowait.collection.forUpdate({ nowait: true }).all().toArray();
    await skipLocked.collection.forShare({ skipLocked: true }).all().toArray();

    expect(sqlOf(nowait.runtime)).toBe(`${postsSql} FOR UPDATE OF "posts" NOWAIT`);
    expect(sqlOf(skipLocked.runtime)).toBe(`${postsSql} FOR SHARE OF "posts" SKIP LOCKED`);
  });

  it('two calls render two clauses in order', async () => {
    const { collection, runtime } = createCollectionFor('Post');

    await collection.forUpdate().forKeyShare({ skipLocked: true }).all().toArray();

    expect(sqlOf(runtime)).toBe(
      `${postsSql} FOR UPDATE OF "posts" FOR KEY SHARE OF "posts" SKIP LOCKED`,
    );
  });

  it('first() renders LIMIT 1 before the clause', async () => {
    const { collection, runtime } = createCollectionFor('Post');

    await collection
      .where((post) => post.views.gt(40))
      .orderBy((post) => post.views.asc())
      .forUpdate({ skipLocked: true })
      .first();

    expect(sqlOf(runtime)).toBe(
      `${postsSql} WHERE "posts"."views" > $1 ORDER BY "posts"."views" ASC LIMIT 1 FOR UPDATE OF "posts" SKIP LOCKED`,
    );
  });

  it('the clause survives where, orderBy, cursor, limit and offset', async () => {
    const { collection, runtime } = createCollectionFor('Post');

    await collection
      .forUpdate()
      .where((post) => post.views.gt(40))
      .orderBy((post) => post.id.asc())
      .cursor({ id: 3 })
      .limit(5)
      .offset(2)
      .all()
      .toArray();

    expect(sqlOf(runtime)).toBe(
      `${postsSql} WHERE ("posts"."views" > $1 AND "posts"."id" > $2) ORDER BY "posts"."id" ASC LIMIT 5 OFFSET 2 FOR UPDATE OF "posts"`,
    );
  });

  describe('a polymorphic model locks only the base table', () => {
    const contract = buildMixedPolyContract();
    const tasksWith = (runtime: MockRuntime) =>
      new Collection({ runtime, context: { ...getTestContext(), contract } }, 'Task', {
        namespaceId: 'public',
      });

    it('without a variant', async () => {
      const runtime = createMockRuntime();

      await tasksWith(runtime).forUpdate().all().toArray();

      expect(sqlOf(runtime, contract)).toBe(
        'SELECT "tasks"."id" AS "id", "tasks"."title" AS "title", "tasks"."type" AS "type", "tasks"."severity" AS "severity", "tasks"."project_id" AS "project_id", "tasks"."parent_id" AS "parent_id", "tasks"."assignee_id" AS "assignee_id", "features"."priority" AS "features__priority", "features"."assignee_id" AS "features__assignee_id" FROM "public"."tasks" LEFT JOIN "public"."features" ON "tasks"."id" = "features"."id" FOR UPDATE OF "tasks"',
      );
    });

    it('the Feature variant', async () => {
      const runtime = createMockRuntime();

      await tasksWith(runtime)
        .variant('feature' as never)
        .forUpdate()
        .all()
        .toArray();

      expect(sqlOf(runtime, contract)).toBe(
        'SELECT "tasks"."id" AS "id", "tasks"."title" AS "title", "tasks"."type" AS "type", "tasks"."project_id" AS "project_id", "tasks"."parent_id" AS "parent_id", "features"."priority" AS "features__priority", "features"."assignee_id" AS "features__assignee_id" FROM "public"."tasks" INNER JOIN "public"."features" ON "tasks"."id" = "features"."id" WHERE "tasks"."type" = $1 FOR UPDATE OF "tasks"',
      );
    });

    it('the Bug variant', async () => {
      const runtime = createMockRuntime();

      await tasksWith(runtime)
        .variant('bug' as never)
        .forUpdate()
        .all()
        .toArray();

      expect(sqlOf(runtime, contract)).toBe(
        'SELECT "tasks"."id" AS "id", "tasks"."title" AS "title", "tasks"."type" AS "type", "tasks"."severity" AS "severity", "tasks"."project_id" AS "project_id", "tasks"."parent_id" AS "parent_id", "tasks"."assignee_id" AS "assignee_id" FROM "public"."tasks" WHERE "tasks"."type" = $1 FOR UPDATE OF "tasks"',
      );
    });
  });
});

describe('ORM row locking, refusals', () => {
  const lockedPosts = () => createCollectionFor('Post').collection.forUpdate();
  const lockedUsers = () => createCollectionFor('User').collection.forUpdate();

  it('a lock with include', async () => {
    await expect(lockedUsers().include('posts').all().toArray()).rejects.toThrow(
      lockIncompatible('include'),
    );
  });

  describe('a lock method inside an include() refinement callback', () => {
    const { collection } = createCollectionFor('User');
    const refusal = lockIncompatible('includeRefinement');

    it.each(['forUpdate', 'forNoKeyUpdate', 'forShare', 'forKeyShare'] as const)(
      '%s throws when called',
      (method) => {
        expect(() => collection.include('posts', (posts) => posts[method]())).toThrow(refusal);
      },
    );

    it('before a scalar reducer', () => {
      expect(() => collection.include('posts', (posts) => posts.forUpdate().count())).toThrow(
        refusal,
      );
    });

    it('in a combine branch', () => {
      expect(() =>
        collection.include('posts', (posts) => posts.combine({ locked: posts.forUpdate() })),
      ).toThrow(refusal);
    });

    it('on an include nested under a scalar reducer', () => {
      expect(() =>
        collection.include('posts', (posts) =>
          posts.include('comments', (comments) => comments.forUpdate()).count(),
        ),
      ).toThrow(refusal);
    });

    it('on an include nested under a combine scalar branch', () => {
      expect(() =>
        collection.include('posts', (posts) =>
          posts.combine({
            count: posts.include('comments', (comments) => comments.forUpdate()).count(),
          }),
        ),
      ).toThrow(refusal);
    });
  });

  describe('a locked state an include refinement returns is refused when lowered', () => {
    const context = getTestContext();
    const namespaceId = soleDomainNamespaceId(context.contract.domain);
    const users = () => createCollectionFor('User').collection;
    const lockedComments = () => createCollectionFor('Comment').collection.forUpdate();
    const postsWithLockedComments = () =>
      new Collection({ runtime: createMockRuntime(), context }, 'Post', {
        namespaceId,
        includeRefinementMode: true,
        state: createCollectionFor('Post').collection.include('comments', () => lockedComments())
          .state,
      });
    const refusal = lockIncompatible('includeRefinement');

    it('as the include rows', async () => {
      await expect(
        users()
          .include('posts', () => lockedPosts())
          .all()
          .toArray(),
      ).rejects.toThrow(refusal);
    });

    it('as an include nested under a scalar reducer', async () => {
      await expect(
        users()
          .include('posts', () => postsWithLockedComments().count())
          .all()
          .toArray(),
      ).rejects.toThrow(refusal);
    });

    it('as a combine rows branch', async () => {
      await expect(
        users()
          .include('posts', (posts) => posts.combine({ locked: lockedPosts() }))
          .all()
          .toArray(),
      ).rejects.toThrow(refusal);
    });

    it('as an include nested under a combine scalar branch', async () => {
      await expect(
        users()
          .include('posts', (posts) => posts.combine({ count: postsWithLockedComments().count() }))
          .all()
          .toArray(),
      ).rejects.toThrow(refusal);
    });
  });

  it('a lock with groupBy', async () => {
    expect(() => lockedPosts().groupBy('userId')).toThrow(lockIncompatible('groupBy'));
  });

  it('a lock with aggregate', async () => {
    await expect(lockedPosts().aggregate((agg) => ({ n: agg.count() }))).rejects.toThrow(
      lockIncompatible('aggregate'),
    );
  });

  it('a lock with distinct', async () => {
    expect(() => lockedPosts().distinct('title').all()).toThrow(lockIncompatible('distinct'));
  });

  it('a lock with distinctOn', async () => {
    expect(() =>
      lockedPosts()
        .orderBy((post) => post.title.asc())
        .distinctOn('title')
        .all(),
    ).toThrow(lockIncompatible('distinctOn'));
  });

  describe('a mutation terminal on a locked collection', () => {
    const lockedWhere = () => lockedPosts().where((post) => post.id.eq(1));

    it.each([
      ['create', () => lockedPosts().create({ title: 't' } as never)],
      ['createAndCount', () => lockedPosts().createAndCount([{ title: 't' }] as never)],
      ['upsert', () => lockedPosts().upsert({ create: {}, update: {} } as never)],
      ['update', () => lockedWhere().update({ title: 't' })],
      ['updateAndCount', () => lockedWhere().updateAndCount({ title: 't' })],
      ['delete', () => lockedWhere().delete()],
      ['deleteAndCount', () => lockedWhere().deleteAndCount()],
    ] as const)('%s rejects', async (_terminal, run) => {
      await expect(run()).rejects.toThrow(lockIncompatible('mutation'));
    });

    it.each([
      ['createAll', () => lockedPosts().createAll([{ title: 't' }] as never)],
      ['updateAll', () => lockedWhere().updateAll({ title: 't' })],
      ['deleteAll', () => lockedWhere().deleteAll()],
    ] as const)('%s throws', (_terminal, run) => {
      expect(run).toThrow(lockIncompatible('mutation'));
    });

    it('update runs no statement, including its read-back', async () => {
      const { collection, runtime } = createCollectionFor('Post');

      await expect(
        collection
          .forUpdate()
          .where((post) => post.id.eq(1))
          .update({ title: 't' }),
      ).rejects.toThrow(lockIncompatible('mutation'));

      expect(runtime.executions).toEqual([]);
    });
  });
});
