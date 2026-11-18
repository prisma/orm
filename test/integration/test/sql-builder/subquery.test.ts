import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: subqueries', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('EXISTS filters to rows with matching subquery', async () => {
    const d = db();
    const rows = await runtime().query(
      d.public.users
        .select('id', 'name')
        .where((f, fns) =>
          fns.exists(
            d.public.posts.select('id').where((pf, pfns) => pfns.eq(pf.posts.user_id, f.users.id)),
          ),
        )
        .orderBy('id')
        .build(),
    );
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('EXISTS correlates on an outer top-level field the inner table also has', async () => {
    const d = db();
    const rows = await runtime().query(
      d.public.users
        .select('id', 'name')
        .where((f, fns) =>
          fns.exists(d.public.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.id))),
        )
        .orderBy('id')
        .build(),
    );
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('IN with subquery and parameters in both parent and subquery', async () => {
    // Users whose id is IN the set of user_ids from posts with views > 50
    // Then further filter parent to name != 'Bob'
    // Posts with views > 50: id=1 (user_id=1, 100), id=3 (user_id=2, 200)
    // So subquery returns user_ids [1, 2]
    // Parent filters out Bob (id=2), leaving only Alice (id=1)
    const d = db();
    const rows = await runtime().query(
      d.public.users
        .select('id', 'name')
        .where((f, fns) =>
          fns.and(
            fns.ne(f.name, 'Bob'),
            fns.in(
              f.id,
              d.public.posts.select('user_id').where((pf, pfns) => pfns.gt(pf.views, 50)),
            ),
          ),
        )
        .orderBy('id')
        .build(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Alice');
    expect(rows[0]!.id).toBe(1);
  });

  it('subquery as join source', async () => {
    const d = db();
    const sub = d.public.posts.select('user_id', 'title').as('sub');
    const rows = await runtime().query(
      d.public.users
        .innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id))
        .select('name', 'title')
        .build(),
    );
    expect(rows.length).toBe(4);
  });
});
