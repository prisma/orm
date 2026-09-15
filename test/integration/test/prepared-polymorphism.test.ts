import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import postgres from '@internal/postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { expect, expectTypeOf, it } from 'vitest';
import { getPolyTestContext } from './sql-orm-client/helpers';

it(
  'preserves polymorphic discriminators and variant-field filtering through facade preparation',
  async () => {
    const database = await createDevDatabase({ databaseIdleTimeoutMillis: timeouts.spinUpPpgDev });
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();
    await client.query(`
    create table tasks (id int4 primary key, title text, type text, severity text, project_id int4, reporter_id int4, bug_assignee_person_id int4);
    create table features (id int4 primary key, priority int4, feature_assignee_person_id int4);
    create table epics (id int4 primary key, scope text);
    insert into tasks (id, title, type, severity) values (1, 'Bug', 'bug', 'critical'), (2, 'Feature', 'feature', null);
    insert into features (id, priority) values (2, 5);
  `);
    const db = postgres({
      contract: getPolyTestContext().contract,
      pg: client,
      verifyMarker: false,
    });
    try {
      const runtime = await db.connect();
      const all = await db.prepare({ first: 'pg/int4@1', second: 'pg/int4@1' }, (p) =>
        db.orm.public.Task.where((task) => task.id.in([p.first, p.second]))
          .orderBy((task) => task.id.asc())
          .select('id', 'title', 'type')
          .prepared.all(),
      );
      expectTypeOf(all.query(runtime, { first: 1, second: 2 })).toEqualTypeOf<
        AsyncIterableResult<{ id: number; title: string; type: string }>
      >();
      expect(await all.query(runtime, { first: 1, second: 2 })).toEqual([
        { id: 1, title: 'Bug', type: 'bug' },
        { id: 2, title: 'Feature', type: 'feature' },
      ]);
      const selected = db.orm.public.Task.variant('Bug')
        .where((task) => task.severity.eq('critical'))
        .select('id', 'title', 'type');
      const first = await db.prepare({ id: 'pg/int4@1' }, (p) =>
        selected.prepared.first({ id: p.id }),
      );
      expectTypeOf(first.query(runtime, { id: 1 })).toEqualTypeOf<
        ReturnType<typeof selected.first>
      >();
      expect(await first.query(runtime, { id: 1 })).toEqual({
        id: 1,
        title: 'Bug',
        type: 'bug',
      });
      expect(await first.query(runtime, { id: 2 })).toBeNull();
    } finally {
      await db.close();
      await client.end();
      await database.close();
    }
  },
  timeouts.spinUpPpgDev,
);
