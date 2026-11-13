import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteAdapterCapabilities } from '@internal/adapter-sqlite/adapter';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import {
  activitySource,
  createExecutionContext,
  createSqlExecutionStack,
  delegatingActivitySource,
} from '@internal/sql-runtime';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/polymorphism-sqlite/generated/contract';
import contractJson from './fixtures/polymorphism-sqlite/generated/contract.json' with {
  type: 'json',
};

const schema = `
  create table projects (id integer primary key autoincrement, name text not null);
  create table people (id integer primary key autoincrement, name text not null);
  create table tasks (id integer primary key autoincrement, title text not null, type text not null, severity text, project_id integer, pinned_by_id integer unique);
  create table features (id integer primary key references tasks(id), priority integer not null);
  create table task_comments (id integer primary key autoincrement, body text not null, task_id integer);
  create table labels (id integer primary key autoincrement, name text not null);
  create table task_labels (task_id integer not null, label_id integer not null, primary key (task_id, label_id));
`;

interface Harness {
  readonly db: ReturnType<typeof orm<Contract>>[typeof UNBOUND_NAMESPACE_ID];
  readonly rows: (sql: string) => unknown[];
}

const {
  returning: _returning,
  insertOnConflictTarget: _target,
  ...capabilitiesWithoutReturning
} = sqliteAdapterCapabilities.sql;

function contractWithoutReturning(): typeof contractJson {
  const copy = JSON.parse(JSON.stringify(contractJson));
  delete copy.capabilities.sql.returning;
  return copy;
}

interface Setup {
  readonly adapter: typeof sqliteAdapter;
  readonly contract: typeof contractJson;
}

const withReturning: Setup = { adapter: sqliteAdapter, contract: contractJson };
const withoutReturning: Setup = {
  adapter: { ...sqliteAdapter, capabilities: { sql: capabilitiesWithoutReturning } },
  contract: contractWithoutReturning(),
};

async function withDatabase(
  run: (harness: Harness) => Promise<void>,
  setup: Setup = withReturning,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-variant-creates-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(schema);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: setup.adapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({
    contract: contractFromJson<Contract>(setup.contract),
    stack,
  });
  const { adapter, driver } = instantiateExecutionStack(stack);
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  try {
    const db = orm({
      context,
      runtime: {
        query: (plan) => runtime.query(plan),
        execute: (plan) => runtime.execute(plan),
        connection: () => runtime.connection(),
        [activitySource]: delegatingActivitySource(() => runtime),
      },
    });
    await run({
      db: db[UNBOUND_NAMESPACE_ID],
      rows: (sql) =>
        database
          .prepare(sql)
          .all()
          .map((row) => ({ ...row })),
    });
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const tasksSql =
  'select id, title, type, severity, project_id, pinned_by_id from tasks order by id';
const featureTasksSql = 'select id, title, type, project_id, pinned_by_id from tasks order by id';
const featuresSql = 'select id, priority from features order by id';
const darkMode = { title: 'Dark mode', priority: 1 };
const exportPdf = { title: 'Export to PDF', priority: 3 };
const search = { title: 'Search', priority: 2 };

function feature(id: number, title: string, links: Record<string, number> = {}) {
  return { id, title, type: 'feature', project_id: null, pinned_by_id: null, ...links };
}

const crash = { title: 'Crash', severity: 'high' };
const hang = { title: 'Hang', severity: 'low' };

function bug(id: number, title: string, severity: string, links: Record<string, number> = {}) {
  return {
    id,
    title,
    type: 'bug',
    severity,
    project_id: null,
    pinned_by_id: null,
    ...links,
  };
}

describe('integration/nested-variant-creates on SQLite', () => {
  describe('a variant stored in the base table on a relation the child holds the key for', () => {
    it(
      'create() writes each row with the discriminator and the key of the parent',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Project.select('id', 'name').create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('bug').create([crash, hang]),
          });
          const single = await db.Project.select('id', 'name').create({
            name: 'Polish',
            tasks: (tasks) => tasks.variant('bug').create(crash),
          });

          expect([created, single]).toEqual([
            { id: 1, name: 'Launch' },
            { id: 2, name: 'Polish' },
          ]);
          expect(rows(tasksSql)).toEqual([
            bug(1, 'Crash', 'high', { project_id: 1 }),
            bug(2, 'Hang', 'low', { project_id: 1 }),
            bug(3, 'Crash', 'high', { project_id: 2 }),
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'update() writes each row with the discriminator and the key of the parent',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          await db.Project.create({ name: 'Launch' });

          const updated = await db.Project.select('id', 'name')
            .where({ id: 1 })
            .update({
              tasks: (tasks) => [
                tasks.variant('bug').create(crash),
                tasks.variant('bug').create([hang]),
              ],
            });

          expect(updated).toEqual({ id: 1, name: 'Launch' });
          expect(rows(tasksSql)).toEqual([
            bug(1, 'Crash', 'high', { project_id: 1 }),
            bug(2, 'Hang', 'low', { project_id: 1 }),
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'create() and update() write the row with the discriminator on a to-one relation',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Person.select('id', 'name').create({
            name: 'Ada',
            pinnedTask: (task) => task.variant('bug').create(crash),
          });
          await db.Person.create({ name: 'Grace' });
          const updated = await db.Person.select('id', 'name')
            .where({ id: 2 })
            .update({
              pinnedTask: (task) => task.variant('bug').create([hang]),
            });

          expect([created, updated]).toEqual([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Grace' },
          ]);
          expect(rows(tasksSql)).toEqual([
            bug(1, 'Crash', 'high', { pinned_by_id: 1 }),
            bug(2, 'Hang', 'low', { pinned_by_id: 2 }),
          ]);
        });
      },
      timeouts.databaseOperation,
    );
  });

  describe('a variant stored in the base table with a relation callback in its row', () => {
    it(
      'create() and update() write the row with the discriminator and the rows of a base relation',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Project.select('id', 'name').create({
            name: 'Launch',
            tasks: (tasks) =>
              tasks.variant('bug').create({
                ...crash,
                comments: (comments) => comments.create({ body: 'Seen it' }),
              }),
          });
          const updated = await db.Project.select('id', 'name')
            .where({ id: 1 })
            .update({
              tasks: (tasks) =>
                tasks
                  .variant('bug')
                  .create([
                    hang,
                    { ...crash, comments: (comments) => comments.create([{ body: 'Again' }]) },
                  ]),
            });

          expect([created, updated]).toEqual([
            { id: 1, name: 'Launch' },
            { id: 1, name: 'Launch' },
          ]);
          expect(rows(tasksSql)).toEqual([
            bug(1, 'Crash', 'high', { project_id: 1 }),
            bug(2, 'Hang', 'low', { project_id: 1 }),
            bug(3, 'Crash', 'high', { project_id: 1 }),
          ]);
          expect(rows('select id, body, task_id from task_comments order by id')).toEqual([
            { id: 1, body: 'Seen it', task_id: 1 },
            { id: 2, body: 'Again', task_id: 3 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );
  });

  describe('a variant stored in the base table on a relation the parent holds the key for', () => {
    it(
      'create() and update() write the row with the discriminator and link the parent to it',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.TaskComment.select('id', 'body', 'taskId').create({
            body: 'Seen it',
            task: (task) => task.variant('bug').create(crash),
          });
          await db.TaskComment.create({ body: 'Again' });
          const updated = await db.TaskComment.select('id', 'body', 'taskId')
            .where({ id: 2 })
            .update({
              task: (task) => task.variant('bug').create([hang]),
            });

          expect([created, updated]).toEqual([
            { id: 1, body: 'Seen it', taskId: 1 },
            { id: 2, body: 'Again', taskId: 2 },
          ]);
          expect(rows(tasksSql)).toEqual([bug(1, 'Crash', 'high'), bug(2, 'Hang', 'low')]);
        });
      },
      timeouts.databaseOperation,
    );
  });

  describe('a variant stored in the base table on a relation through a junction', () => {
    it(
      'create() writes each row with the discriminator and links it',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Label.select('id', 'name').create({
            name: 'ui',
            tasks: (tasks) => tasks.variant('bug').create([crash, hang]),
          });
          const single = await db.Label.select('id', 'name').create({
            name: 'api',
            tasks: (tasks) => tasks.variant('bug').create(crash),
          });

          expect([created, single]).toEqual([
            { id: 1, name: 'ui' },
            { id: 2, name: 'api' },
          ]);
          expect(rows(tasksSql)).toEqual([
            bug(1, 'Crash', 'high'),
            bug(2, 'Hang', 'low'),
            bug(3, 'Crash', 'high'),
          ]);
          expect(rows('select label_id, task_id from task_labels order by task_id')).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
            { label_id: 2, task_id: 3 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'update() writes each row with the discriminator and links it',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          await db.Label.create({ name: 'ui' });

          const updated = await db.Label.select('id', 'name')
            .where({ id: 1 })
            .update({
              tasks: (tasks) => [
                tasks.variant('bug').create(crash),
                tasks.variant('bug').create([hang]),
              ],
            });

          expect(updated).toEqual({ id: 1, name: 'ui' });
          expect(rows(tasksSql)).toEqual([bug(1, 'Crash', 'high'), bug(2, 'Hang', 'low')]);
          expect(rows('select label_id, task_id from task_labels order by task_id')).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );
  });

  describe('a variant stored in its own table', () => {
    it(
      'create() and update() on a relation the child holds the key for write both tables per row',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Project.select('id', 'name').create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('feature').create([darkMode, exportPdf]),
          });
          const updated = await db.Project.select('id', 'name')
            .where({ id: 1 })
            .update({ tasks: (tasks) => tasks.variant('feature').create(search) });

          expect([created, updated]).toEqual([
            { id: 1, name: 'Launch' },
            { id: 1, name: 'Launch' },
          ]);
          expect(rows(featureTasksSql)).toEqual([
            feature(1, 'Dark mode', { project_id: 1 }),
            feature(2, 'Export to PDF', { project_id: 1 }),
            feature(3, 'Search', { project_id: 1 }),
          ]);
          expect(rows(featuresSql)).toEqual([
            { id: 1, priority: 1 },
            { id: 2, priority: 3 },
            { id: 3, priority: 2 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'create() and update() on a to-one relation write both tables with the key of the parent',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Person.select('id', 'name').create({
            name: 'Ada',
            pinnedTask: (task) => task.variant('feature').create(darkMode),
          });
          await db.Person.create({ name: 'Grace' });
          const updated = await db.Person.select('id', 'name')
            .where({ id: 2 })
            .update({ pinnedTask: (task) => task.variant('feature').create([exportPdf]) });

          expect([created, updated]).toEqual([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Grace' },
          ]);
          expect(rows(featureTasksSql)).toEqual([
            feature(1, 'Dark mode', { pinned_by_id: 1 }),
            feature(2, 'Export to PDF', { pinned_by_id: 2 }),
          ]);
          expect(rows(featuresSql)).toEqual([
            { id: 1, priority: 1 },
            { id: 2, priority: 3 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'create() and update() on a relation the parent holds the key for write both tables and link the parent',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.TaskComment.select('id', 'body', 'taskId').create({
            body: 'Seen it',
            task: (task) => task.variant('feature').create(darkMode),
          });
          const updated = await db.TaskComment.select('id', 'body', 'taskId')
            .where({ id: 1 })
            .update({ task: (task) => task.variant('feature').create([exportPdf]) });

          expect([created, updated]).toEqual([
            { id: 1, body: 'Seen it', taskId: 1 },
            { id: 1, body: 'Seen it', taskId: 2 },
          ]);
          expect(rows(featureTasksSql)).toEqual([
            feature(1, 'Dark mode'),
            feature(2, 'Export to PDF'),
          ]);
          expect(rows(featuresSql)).toEqual([
            { id: 1, priority: 1 },
            { id: 2, priority: 3 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'create() and update() on a relation through a junction write both tables and link each row',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const created = await db.Label.select('id', 'name').create({
            name: 'ui',
            tasks: (tasks) => tasks.variant('feature').create([darkMode, exportPdf]),
          });
          const updated = await db.Label.select('id', 'name')
            .where({ id: 1 })
            .update({ tasks: (tasks) => tasks.variant('feature').create(search) });

          expect([created, updated]).toEqual([
            { id: 1, name: 'ui' },
            { id: 1, name: 'ui' },
          ]);
          expect(rows(featureTasksSql)).toEqual([
            feature(1, 'Dark mode'),
            feature(2, 'Export to PDF'),
            feature(3, 'Search'),
          ]);
          expect(rows(featuresSql)).toEqual([
            { id: 1, priority: 1 },
            { id: 2, priority: 3 },
            { id: 3, priority: 2 },
          ]);
          expect(rows('select label_id, task_id from task_labels order by task_id')).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
            { label_id: 1, task_id: 3 },
          ]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'writes no row of either table when a later row of the call fails',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          expect(
            await rejectionShape(
              db.Project.create({
                name: 'Launch',
                tasks: (tasks) =>
                  tasks.variant('feature').create([
                    { id: 7, ...darkMode },
                    { id: 7, ...exportPdf },
                  ]),
              }),
            ),
          ).toMatchObject({
            name: 'SqlQueryError',
            kind: 'sql_query',
            sqlState: '23505',
            constraint: 'tasks.id',
            message: 'UNIQUE constraint failed: tasks.id',
          });

          expect(rows('select id from projects')).toEqual([]);
          expect(rows(featureTasksSql)).toEqual([]);
          expect(rows(featuresSql)).toEqual([]);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'is refused without returning as the top-level variant create refuses it, and writes nothing',
      async () => {
        await withDatabase(async ({ db, rows }) => {
          const topLevel = await db.Task.variant('feature')
            .create(darkMode)
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          const nested = await db.Project.create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('feature').create(darkMode),
          }).then(
            () => undefined,
            (error: unknown) => error,
          );

          expect(topLevel).toMatchObject({
            code: 'ORM.CAPABILITY_MISSING',
            meta: { capability: 'returning', action: 'createAll()' },
          });
          expect(nested).toEqual(topLevel);
          expect(rows('select id from projects')).toEqual([]);
          expect(rows(featureTasksSql)).toEqual([]);
        }, withoutReturning);
      },
      timeouts.databaseOperation,
    );
  });
});
