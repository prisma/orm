import { postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import { createRawLane } from '@internal/sql-builder/runtime';
import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: a builder query embedded in a raw statement', {
  timeout: timeouts.databaseOperation,
}, () => {
  const { db, runtime, context, lower } = setupIntegrationTest();
  const raw = () => createRawLane({ context: context(), rawCodecInferer: postgresRawCodecInferer });

  it('inserts the rows of an embedded select, with params before, inside and after it', async () => {
    const d = db();
    const copies = d.public.posts
      .innerJoin(d.public.users, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
      .select((f, fns) => ({
        id: f.posts.id,
        title: f.posts.title,
        subtitle: f.users.name,
        body: fns.raw`${'copied'}`.returns('pg/text@1'),
      }))
      .where((f, fns) => fns.gt(f.posts.views, 60));
    const documents = d.public.documents;

    const plan = raw().sql`
      WITH batch AS (SELECT ${'batch-7'}::text AS label)
      INSERT INTO documents (id, title, subtitle, body)
      ${copies}
      RETURNING id, title, subtitle, body, (SELECT label FROM batch) AS batch, id + ${1000} AS shifted_id
    `
      .returnsRow({
        id: documents.columns.id,
        title: documents.columns.title,
        subtitle: documents.columns.subtitle,
        body: documents.columns.body,
        batch: 'pg/text@1',
        shifted_id: 'pg/int4@1',
      })
      .build();

    const lowered = lower(plan);
    expect(lowered.sql).toContain(
      'INSERT INTO documents (id, title, subtitle, body)\n      SELECT ',
    );
    expect(lowered.params).toEqual(['batch-7', 'copied', 60, 1000]);

    const rows = await runtime().query(plan);
    const byId = [...rows].sort((a, b) => a.id - b.id);
    expect(byId).toEqual([
      {
        id: 1,
        title: 'Hello World',
        subtitle: 'Alice',
        body: 'copied',
        batch: 'batch-7',
        shifted_id: 1001,
      },
      {
        id: 3,
        title: 'Bobs Post',
        subtitle: 'Bob',
        body: 'copied',
        batch: 'batch-7',
        shifted_id: 1003,
      },
    ]);

    const stored = await runtime().query(
      d.public.documents.select('id', 'title', 'subtitle', 'body').orderBy('id').build(),
    );
    expect(stored).toEqual([
      { id: 1, title: 'Hello World', subtitle: 'Alice', body: 'copied' },
      { id: 3, title: 'Bobs Post', subtitle: 'Bob', body: 'copied' },
    ]);
  });

  it('reads an embedded select as a CTE body', async () => {
    const d = db();
    const invitees = d.public.users
      .select('id', 'name')
      .where((f, fns) => fns.eq(f.invited_by_id, 1));

    const plan = raw().sql`
      WITH invitees AS (${invitees})
      SELECT count(*)::int4 AS n, string_agg(name, ',' ORDER BY name) AS names FROM invitees
    `
      .returnsRow({ n: 'pg/int4@1', names: 'pg/text@1' })
      .build();

    expect(await runtime().query(plan)).toEqual([{ n: 2, names: 'Bob,Charlie' }]);
  });

  it('feeds an embedded update with returning into the outer statement as a data-modifying CTE', async () => {
    const d = db();
    const renamed = d.public.profiles
      .update({ bio: 'Rewritten bio' })
      .where((f, fns) => fns.eq(f.user_id, 2))
      .returning('id', 'user_id');

    const plan = raw().sql`
      WITH renamed AS (${renamed})
      SELECT renamed.id, users.name FROM renamed JOIN users ON users.id = renamed.user_id
    `
      .returnsRow({ id: d.public.profiles.columns.id, name: d.public.users.columns.name })
      .build();

    expect(await runtime().query(plan)).toEqual([{ id: 2, name: 'Bob' }]);

    const stored = await runtime().query(
      d.public.profiles
        .select('id', 'bio')
        .where((f, fns) => fns.eq(f.id, 2))
        .build(),
    );
    expect(stored).toEqual([{ id: 2, bio: 'Rewritten bio' }]);
  });
});
