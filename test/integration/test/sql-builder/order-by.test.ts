import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: ORDER BY', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('sorts by column descending', async () => {
    const rows = await runtime().query(
      db().public.users.select('id', 'name').orderBy('name', { direction: 'desc' }).build(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]!.name).toBe('Diana');
    expect(rows[3]!.name).toBe('Alice');
  });

  it('sorts by column ascending (default)', async () => {
    const rows = await runtime().query(db().public.users.select('id').orderBy('id').build());
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('sorts by expression callback', async () => {
    const rows = await runtime().query(
      db()
        .public.posts.select('id', 'views')
        .orderBy((f) => f.views, { direction: 'desc' })
        .build(),
    );
    expect(rows[0]!.views).toBe(200);
    expect(rows[rows.length - 1]!.views).toBe(10);
  });

  it('alias column can be used in ORDER BY by name', async () => {
    const rows = await runtime().query(
      db()
        .public.posts.select('id')
        .select('v', (f) => f.views)
        .orderBy('v', { direction: 'desc' })
        .build(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]!.v).toBe(200);
  });

  it('multiple orderBy calls accumulate', async () => {
    const rows = await runtime().query(
      db()
        .public.posts.select('user_id', 'views')
        .orderBy('user_id')
        .orderBy('views', { direction: 'desc' })
        .build(),
    );
    const alicePosts = rows.filter((r) => r.user_id === 1);
    expect(alicePosts[0]!.views).toBeGreaterThan(alicePosts[1]!.views);
  });

  it('NULLS FIRST places nulls before non-null values', async () => {
    const rows = await runtime().execute(
      db()
        .public.users.select('id', 'invited_by_id')
        .orderBy('invited_by_id', { nulls: 'first' })
        .orderBy('id')
        .build(),
    );
    expect(rows).toEqual([
      { id: 1, invited_by_id: null },
      { id: 2, invited_by_id: 1 },
      { id: 3, invited_by_id: 1 },
      { id: 4, invited_by_id: 2 },
    ]);
  });

  it('NULLS LAST places nulls after non-null values', async () => {
    const rows = await runtime().execute(
      db()
        .public.users.select('id', 'invited_by_id')
        .orderBy('invited_by_id', { nulls: 'last' })
        .orderBy('id')
        .build(),
    );
    expect(rows).toEqual([
      { id: 2, invited_by_id: 1 },
      { id: 3, invited_by_id: 1 },
      { id: 4, invited_by_id: 2 },
      { id: 1, invited_by_id: null },
    ]);
  });
});
