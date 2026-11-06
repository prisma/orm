import pgvector from '@internal/extension-pgvector/runtime';
import type { RuntimeLog } from '@internal/framework-components/runtime';
import {
  type CachedValue,
  type CacheStore,
  cacheAnnotation,
  createCacheMiddleware,
  createInMemoryCacheStore,
  invalidateAnnotation,
} from '@internal/middleware-cache';
import postgres from '@internal/postgres/runtime';
import { sql } from '@internal/sql-builder/runtime';
import { Collection } from '@internal/sql-orm-client';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { getPolyTestContext } from '../sql-orm-client/helpers';
import { withCollectionRuntime } from '../sql-orm-client/integration-helpers';
import type { PgIntegrationRuntime } from '../sql-orm-client/runtime-helpers';
import { useMiddlewareCacheDatabase } from './middleware-cache-database';

function statementsFromDriver(events: string[]): SqlMiddleware {
  return {
    name: 'statements-from-driver',
    familyId: 'sql',
    async activityEnded(activity, result) {
      if (activity.kind === 'statement' && result.kind === 'statement') {
        if (result.source === 'driver') events.push('statement');
      }
      if (activity.kind === 'transaction') events.push(`transaction-${result.outcome}`);
    },
  };
}

function writeOutcomes(outcomes: string[]): SqlMiddleware {
  return {
    name: 'write-outcomes',
    familyId: 'sql',
    async activityFinalized(activity, result) {
      if (activity.kind === 'orm-call' && activity.annotations.has('cache-invalidate')) {
        outcomes.push(result.outcome);
      }
    },
  };
}

function recordingStore(events: string[], unset?: CacheStore['unset']): CacheStore {
  const inner = createInMemoryCacheStore();
  return {
    get: (target) => inner.get(target),
    set: (entry, value: CachedValue) => inner.set(entry, value),
    async unset(target) {
      events.push(`unset:${target.keys?.join(',')}`);
      await (unset ?? inner.unset)(target);
    },
  };
}

describe('integration: a write annotated with invalidateAnnotation invalidates once it is final', {
  timeout: timeouts.databaseOperation,
}, () => {
  const database = useMiddlewareCacheDatabase();

  async function withFacade(
    fn: (setup: {
      readonly db: ReturnType<typeof createFacade>;
      readonly events: string[];
      readonly outcomes: string[];
      readonly log: { readonly error: ReturnType<typeof vi.fn> };
    }) => Promise<void>,
    unset?: CacheStore['unset'],
  ): Promise<void> {
    const events: string[] = [];
    const outcomes: string[] = [];
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();
    const db = createFacade(client, events, outcomes, log, unset);
    try {
      await fn({ db, events, outcomes, log });
    } finally {
      await db.close();
      await client.end();
      await database.client.query(`UPDATE users SET name = 'Alice' WHERE id = 1`);
      await database.client.query('DELETE FROM posts WHERE id >= 900');
      await database.client.query(`UPDATE users SET name = 'Bob' WHERE id = 2`);
    }
  }

  function createFacade(
    client: Client,
    events: string[],
    outcomes: string[],
    log: RuntimeLog,
    unset: CacheStore['unset'] | undefined,
  ) {
    return postgres({
      contract: database.contract,
      pg: client,
      verifyMarker: false,
      extensions: [pgvector],
      log,
      middleware: [
        createCacheMiddleware({ store: recordingStore(events, unset) }),
        statementsFromDriver(events),
        writeOutcomes(outcomes),
      ],
    });
  }

  type Users = ReturnType<typeof createFacade>['orm']['public']['User'];

  function readUserOne(users: Users) {
    return users
      .select('name')
      .first({ id: 1 }, (meta) => meta.annotate(cacheAnnotation({ key: 'user-1' })));
  }

  it('invalidates after an ORM update outside a transaction has committed', async () => {
    await withFacade(async ({ db, events, outcomes }) => {
      await readUserOne(db.orm.public.User);
      events.length = 0;

      await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
        meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
      );
      const lastTwoEvents = events.slice(-2);
      const read = await readUserOne(db.orm.public.User);

      expect({ outcomes, lastTwoEvents, unsets: unsetsIn(events), read }).toEqual({
        outcomes: ['committed'],
        lastTwoEvents: ['transaction-succeeded', 'unset:user-1'],
        unsets: ['unset:user-1'],
        read: { name: 'Alicia' },
      });
    });
  });

  it('inside db.transaction(fn), keeps serving the entry until the commit, then misses', async () => {
    await withFacade(async ({ db, events }) => {
      await readUserOne(db.orm.public.User);
      events.length = 0;

      const duringTransaction = await db.transaction(async (tx) => {
        await tx.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
          meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
        );
        const statementsBeforeRead = events.length;
        const read = await readUserOne(db.orm.public.User);
        return { read, events: events.slice(statementsBeforeRead) };
      });
      const afterCommit = await readUserOne(db.orm.public.User);

      expect({ duringTransaction, afterCommit, unsets: unsetsIn(events) }).toEqual({
        duringTransaction: { read: { name: 'Alice' }, events: [] },
        afterCommit: { name: 'Alicia' },
        unsets: ['unset:user-1'],
      });
    });
  });

  it('leaves the entry in place when db.transaction(fn) throws after the write', async () => {
    await withFacade(async ({ db, events }) => {
      await readUserOne(db.orm.public.User);
      events.length = 0;

      await expect(
        db.transaction(async (tx) => {
          await tx.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
            meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
          );
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      const eventsBeforeRead = events.length;
      const read = await readUserOne(db.orm.public.User);

      expect({
        read,
        unsets: unsetsIn(events),
        readEvents: events.slice(eventsBeforeRead),
      }).toEqual({ read: { name: 'Alice' }, unsets: [], readEvents: [] });
    });
  });

  it('invalidates once for each annotated write in db.transaction(fn), after the commit', async () => {
    await withFacade(async ({ db, events }) => {
      const unsetsDuringTransaction = await db.transaction(async (tx) => {
        await tx.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
          meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
        );
        await tx.orm.public.User.where({ id: 2 }).update({ name: 'Robert' }, (meta) =>
          meta.annotate(invalidateAnnotation({ keys: ['user-2'] })),
        );
        return unsetsIn(events);
      });

      expect({
        unsetsDuringTransaction,
        afterCommit: events.slice(events.indexOf('transaction-succeeded') + 1),
      }).toEqual({
        unsetsDuringTransaction: [],
        afterCommit: ['unset:user-1', 'unset:user-2'],
      });
    });
  });

  it('invalidates an annotated SQL builder write inside db.transaction(fn) after the commit', async () => {
    await withFacade(async ({ db, events }) => {
      await readUserOne(db.orm.public.User);

      const unsetsDuringTransaction = await db.transaction(async (tx) => {
        await tx.execute(
          tx.sql.public.users
            .update({ name: 'Alicia' })
            .where((f, fns) => fns.eq(f.id, 1))
            .annotate(invalidateAnnotation({ keys: ['user-1'] }))
            .build(),
        );
        return unsetsIn(events);
      });
      const read = await readUserOne(db.orm.public.User);

      expect({ unsetsDuringTransaction, unsets: unsetsIn(events), read }).toEqual({
        unsetsDuringTransaction: [],
        unsets: ['unset:user-1'],
        read: { name: 'Alicia' },
      });
    });
  });

  it('on the default store, an annotation with meta logs the refusal and removes no keys', async () => {
    await withFacade(async ({ db, events, log }) => {
      await readUserOne(db.orm.public.User);

      const updated = await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
        meta.annotate(invalidateAnnotation({ keys: ['user-1'], meta: { tags: ['users'] } })),
      );
      const eventsBeforeRead = events.length;
      const read = await readUserOne(db.orm.public.User);

      expect({
        updated,
        read,
        readEvents: events.slice(eventsBeforeRead),
        logged: log.error.mock.calls,
      }).toEqual({
        updated: expect.objectContaining({ name: 'Alicia' }),
        read: { name: 'Alice' },
        readEvents: [],
        logged: [
          [
            {
              event: 'middleware.activityFinalized.error',
              middleware: 'cache',
              error: expect.objectContaining({ code: 'RUNTIME.CACHE_STORE_META_UNSUPPORTED' }),
            },
          ],
        ],
      });
    });
  });

  it('an ORM read terminal refuses invalidateAnnotation at run time', async () => {
    await withFacade(async ({ db, events }) => {
      const refusedAnnotation: never = invalidateAnnotation({ keys: ['user-1'] }) as never;

      await expect(
        db.orm.public.User.first({ id: 1 }, (meta) => meta.annotate(refusedAnnotation)),
      ).rejects.toMatchObject({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' });
      expect(events).toEqual([]);
    });
  });

  it('invalidates after an update with a relation callback', async () => {
    await withFacade(async ({ db, events }) => {
      await readUserOne(db.orm.public.User);

      await db.orm.public.User.where({ id: 1 }).update(
        {
          name: 'Alicia',
          posts: (posts) => posts.create([{ id: 900, title: 'Nested', views: 0 }]),
        },
        (meta) => meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
      );
      const read = await readUserOne(db.orm.public.User);

      expect({ read, unsets: unsetsIn(events) }).toEqual({
        read: { name: 'Alicia' },
        unsets: ['unset:user-1'],
      });
    });
  });

  it('invalidates after a write that fails, since it may have landed', async () => {
    await withFacade(async ({ db, events, outcomes }) => {
      await readUserOne(db.orm.public.User);

      await expect(
        db.orm.public.User.create(
          { id: 1, name: 'Duplicate', email: 'duplicate@example.com' },
          (meta) => meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
        ),
      ).rejects.toThrow();

      expect({ outcomes, unsets: unsetsIn(events) }).toEqual({
        outcomes: ['unknown'],
        unsets: ['unset:user-1'],
      });
    });
  });

  it('logs a store error from the invalidation and keeps the committed write', async () => {
    const failure = new Error('store down');
    await withFacade(
      async ({ db, log }) => {
        const updated = await db.orm.public.User.where({ id: 1 }).update(
          { name: 'Alicia' },
          (meta) => meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
        );
        const stored = await database.client.query('SELECT name FROM users WHERE id = 1');

        expect({ updated, stored: stored.rows, logged: log.error.mock.calls }).toEqual({
          updated: expect.objectContaining({ name: 'Alicia' }),
          stored: [{ name: 'Alicia' }],
          logged: [
            [{ event: 'middleware.activityFinalized.error', middleware: 'cache', error: failure }],
          ],
        });
      },
      async () => {
        throw failure;
      },
    );
  });

  it('invalidates after an annotated SQL builder write', async () => {
    const events: string[] = [];
    const runtime = database.buildRuntime([
      createCacheMiddleware({ store: recordingStore(events) }),
    ]);
    const builder = sql({
      context: database.context,
      rawCodecInferer: { inferCodec: () => 'pg/text' },
    });
    const readName = () =>
      runtime
        .query(
          builder.public.users
            .select('name')
            .where((f, fns) => fns.eq(f.id, 1))
            .annotate(cacheAnnotation({ key: 'user-1-row' }))
            .build(),
        )
        .toArray();

    try {
      await readName();
      await runtime.execute(
        builder.public.users
          .update({ name: 'Alicia' })
          .where((f, fns) => fns.eq(f.id, 1))
          .annotate(invalidateAnnotation({ keys: ['user-1-row'] }))
          .build(),
      );

      expect({ read: await readName(), unsets: unsetsIn(events) }).toEqual({
        read: [{ name: 'Alicia' }],
        unsets: ['unset:user-1-row'],
      });
    } finally {
      await database.client.query(`UPDATE users SET name = 'Alice' WHERE id = 1`);
    }
  });
});

function unsetsIn(events: readonly string[]): string[] {
  return events.filter((event) => event.startsWith('unset:'));
}

describe('integration: a create on a multi-table-inheritance model invalidates', {
  timeout: timeouts.spinUpPpgDev,
}, () => {
  const polyContext = getPolyTestContext();

  async function setupPolySchema(runtime: PgIntegrationRuntime): Promise<void> {
    await runtime.query('drop table if exists features');
    await runtime.query('drop table if exists epics');
    await runtime.query('drop table if exists tasks');
    await runtime.query(`
      create table tasks (
        id serial primary key,
        title text not null,
        type text not null,
        severity text,
        project_id integer,
        reporter_id integer,
        bug_assignee_person_id integer
      )
    `);
    await runtime.query(`
      create table features (
        id integer primary key references tasks(id),
        priority integer not null,
        feature_assignee_person_id integer
      )
    `);
  }

  it('invalidates after a create() on a variant stored in its own table', async () => {
    const events: string[] = [];
    const cache = createCacheMiddleware({ store: recordingStore(events) });
    await withCollectionRuntime(
      async (runtime) => {
        await setupPolySchema(runtime);
        const features = new Collection({ runtime, context: polyContext }, 'Task', {
          namespaceId: 'public',
        }).variant('feature');
        const readTitles = () =>
          features
            .select('title')
            .all((meta) => meta.annotate(cacheAnnotation({ key: 'features' })))
            .toArray();

        const before = await readTitles();
        await features.create({ title: 'Dark mode', priority: 1 }, (meta) =>
          meta.annotate(invalidateAnnotation({ keys: ['features'] })),
        );
        const after = await readTitles();

        expect({ before, after, unsets: unsetsIn(events) }).toEqual({
          before: [],
          after: [{ title: 'Dark mode' }],
          unsets: ['unset:features'],
        });
      },
      polyContext.contract,
      [],
      [cache],
    );
  });
});
