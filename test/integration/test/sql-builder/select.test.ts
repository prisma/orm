import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: SELECT', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('basic column projection returns correct rows', async () => {
    const rows = await runtime().query(db().public.users.select('id', 'name').build());
    expect(rows).toHaveLength(4);
    expect(typeof rows[0]!.id).toBe('number');
    expect(typeof rows[0]!.name).toBe('string');
  });

  it('aliased expression select', async () => {
    const rows = await runtime().query(
      db()
        .public.users.select('id')
        .select('userName', (f) => f.name)
        .build(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).toHaveProperty('userName');
  });

  it('callback record select', async () => {
    const rows = await runtime().query(
      db()
        .public.users.select((f) => ({ myId: f.id, myName: f.name }))
        .build(),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('myId');
    expect(rows[0]).toHaveProperty('myName');
  });

  it('chained select accumulates projections', async () => {
    const rows = await runtime().query(db().public.users.select('id').select('name').build());
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).toHaveProperty('name');
  });
  it('computed projections decode through the codec of their return type', async () => {
    const d = db();
    const rows = await runtime().query(
      d.public.posts
        .select('id')
        .select((f, fns) => ({
          isFirst: fns.eq(f.id, 1),
          hasComments: fns.exists(
            d.public.comments
              .select('id')
              .where((cf, cfns) => cfns.eq(cf.comments.post_id, f.posts.id)),
          ),
          distance: fns.cosineDistance(f.embedding, [1, 0, 0]),
        }))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows).toEqual([{ id: 1, isFirst: true, hasComments: true, distance: 0 }]);
  });
  it('a raw expression typed by a codec that needs type parameters returns the stored text', async () => {
    const rows = await runtime().query(
      db()
        .public.posts.select('id')
        .select('mood', (_f, fns) => fns.raw`'happy'`.returns('pg/enum@1'))
        .where((f, fns) => fns.eq(f.id, 1))
        .build(),
    );
    expect(rows).toEqual([{ id: 1, mood: 'happy' }]);
  });
});
