import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';
import { getPolyTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const polyContext = getPolyTestContext();

function collectionsOf(runtime: PgIntegrationRuntime) {
  const context = { runtime, context: polyContext };
  const options = { namespaceId: 'public' };
  return {
    projects: new Collection(context, 'Project', options).select('id', 'name'),
    comments: new Collection(context, 'TaskComment', options).select('id', 'body', 'taskId'),
    labels: new Collection(context, 'Label', options).select('id', 'name'),
    tasks: new Collection(context, 'Task', options),
  };
}

async function setupSchema(runtime: PgIntegrationRuntime): Promise<void> {
  for (const table of [
    'task_labels',
    'labels',
    'task_comments',
    'features',
    'epics',
    'tasks',
    'projects_tbl',
  ]) {
    await runtime.query(`drop table if exists ${table}`);
  }
  await runtime.query('create table projects_tbl (id serial primary key, name text not null)');
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
  await runtime.query(
    'create table epics (id integer primary key references tasks(id), scope text not null)',
  );
  await runtime.query(
    'create table task_comments (id serial primary key, body text not null, task_id integer)',
  );
  await runtime.query('create table labels (id serial primary key, name text not null)');
  await runtime.query(
    'create table task_labels (task_id integer not null, label_id integer not null, primary key (task_id, label_id))',
  );
}

function storedTasks(runtime: PgIntegrationRuntime) {
  return runtime.query('select id, title, type, severity, project_id from tasks order by id');
}

async function storedFeatures(runtime: PgIntegrationRuntime) {
  return {
    tasks: await runtime.query('select id, title, type, project_id from tasks order by id'),
    features: await runtime.query('select id, priority from features order by id'),
  };
}

const darkMode = { title: 'Dark mode', priority: 1 };
const exportPdf = { title: 'Export to PDF', priority: 3 };
const search = { title: 'Search', priority: 2 };
const crash = { title: 'Crash', severity: 'high' };
const hang = { title: 'Hang', severity: 'low' };

describe('integration/nested-variant-creates', () => {
  describe('a variant stored in the base table on a relation the child holds the key for', () => {
    it(
      'create() writes each row with the discriminator and the key of the parent',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects } = collectionsOf(runtime);

          const created = await projects.create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('bug').create([crash, hang]),
          });
          const single = await projects.create({
            name: 'Polish',
            tasks: (tasks) => tasks.variant('bug').create(crash),
          });

          expect([created, single]).toEqual([
            { id: 1, name: 'Launch' },
            { id: 2, name: 'Polish' },
          ]);
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: 1 },
            { id: 2, title: 'Hang', type: 'bug', severity: 'low', project_id: 1 },
            { id: 3, title: 'Crash', type: 'bug', severity: 'high', project_id: 2 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() writes each row with the discriminator and the key of the parent',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          await runtime.query("insert into projects_tbl (id, name) values (1, 'Launch')");
          const { projects } = collectionsOf(runtime);

          const updated = await projects.where({ id: 1 }).update({
            tasks: (tasks) => [
              tasks.variant('bug').create(crash),
              tasks.variant('bug').create([hang]),
            ],
          });

          expect(updated).toEqual({ id: 1, name: 'Launch' });
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: 1 },
            { id: 2, title: 'Hang', type: 'bug', severity: 'low', project_id: 1 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('a variant stored in the base table with a relation callback in its row', () => {
    it(
      'create() and update() write the row with the discriminator and the rows of a base relation',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects } = collectionsOf(runtime);

          const created = await projects.create({
            name: 'Launch',
            tasks: (tasks) =>
              tasks.variant('bug').create({
                ...crash,
                comments: (comments) => comments.create({ body: 'Seen it' }),
              }),
          });
          const updated = await projects.where({ id: 1 }).update({
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
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: 1 },
            { id: 2, title: 'Hang', type: 'bug', severity: 'low', project_id: 1 },
            { id: 3, title: 'Crash', type: 'bug', severity: 'high', project_id: 1 },
          ]);
          expect(
            await runtime.query('select id, body, task_id from task_comments order by id'),
          ).toEqual([
            { id: 1, body: 'Seen it', task_id: 1 },
            { id: 2, body: 'Again', task_id: 3 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses a callback on a relation of the variant with the error of the top-level variant create',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects, tasks } = collectionsOf(runtime);
          const topLevel = await tasks
            .variant('bug')
            .create({ ...crash, assignee: (assignee) => assignee.create({ name: 'Ada' }) })
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          const nested = await projects
            .create({
              name: 'Launch',
              tasks: (related) =>
                related
                  .variant('bug')
                  .create({ ...crash, assignee: (assignee) => assignee.create({ name: 'Ada' }) }),
            })
            .then(
              () => undefined,
              (error: unknown) => error,
            );

          expect(topLevel).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
          expect(nested).toEqual(topLevel);
          expect(await runtime.query('select id from projects_tbl')).toEqual([]);
          expect(await storedTasks(runtime)).toEqual([]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('a variant stored in the base table on a relation the parent holds the key for', () => {
    it(
      'create() writes the row with the discriminator and links the parent to it',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { comments } = collectionsOf(runtime);

          const created = await comments.create({
            body: 'Seen it',
            task: (task) => task.variant('bug').create(crash),
          });

          expect(created).toEqual({ id: 1, body: 'Seen it', taskId: 1 });
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: null },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() writes the row with the discriminator and links the parent to it',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          await runtime.query("insert into task_comments (id, body) values (1, 'Seen it')");
          const { comments } = collectionsOf(runtime);

          const updated = await comments.where({ id: 1 }).update({
            task: (task) => task.variant('bug').create([hang]),
          });

          expect(updated).toEqual({ id: 1, body: 'Seen it', taskId: 1 });
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Hang', type: 'bug', severity: 'low', project_id: null },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('a variant stored in the base table on a relation through a junction', () => {
    it(
      'create() writes each row with the discriminator and links it',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { labels } = collectionsOf(runtime);

          const created = await labels.create({
            name: 'ui',
            tasks: (tasks) => tasks.variant('bug').create([crash, hang]),
          });
          const single = await labels.create({
            name: 'api',
            tasks: (tasks) => tasks.variant('bug').create(crash),
          });

          expect([created, single]).toEqual([
            { id: 1, name: 'ui' },
            { id: 2, name: 'api' },
          ]);
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: null },
            { id: 2, title: 'Hang', type: 'bug', severity: 'low', project_id: null },
            { id: 3, title: 'Crash', type: 'bug', severity: 'high', project_id: null },
          ]);
          expect(
            await runtime.query('select label_id, task_id from task_labels order by task_id'),
          ).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
            { label_id: 2, task_id: 3 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() writes each row with the discriminator and links it',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          await runtime.query("insert into labels (id, name) values (1, 'ui')");
          const { labels } = collectionsOf(runtime);

          const updated = await labels.where({ id: 1 }).update({
            tasks: (tasks) => [
              tasks.variant('bug').create(crash),
              tasks.variant('bug').create([hang]),
            ],
          });

          expect(updated).toEqual({ id: 1, name: 'ui' });
          expect(await storedTasks(runtime)).toEqual([
            { id: 1, title: 'Crash', type: 'bug', severity: 'high', project_id: null },
            { id: 2, title: 'Hang', type: 'bug', severity: 'low', project_id: null },
          ]);
          expect(
            await runtime.query('select label_id, task_id from task_labels order by task_id'),
          ).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('a variant stored in its own table', () => {
    it(
      'create() and update() on a relation the child holds the key for write both tables per row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects } = collectionsOf(runtime);

          const created = await projects.create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('feature').create([darkMode, exportPdf]),
          });
          const updated = await projects.where({ id: 1 }).update({
            tasks: (tasks) => tasks.variant('feature').create(search),
          });

          expect([created, updated]).toEqual([
            { id: 1, name: 'Launch' },
            { id: 1, name: 'Launch' },
          ]);
          expect(await storedFeatures(runtime)).toEqual({
            tasks: [
              { id: 1, title: 'Dark mode', type: 'feature', project_id: 1 },
              { id: 2, title: 'Export to PDF', type: 'feature', project_id: 1 },
              { id: 3, title: 'Search', type: 'feature', project_id: 1 },
            ],
            features: [
              { id: 1, priority: 1 },
              { id: 2, priority: 3 },
              { id: 3, priority: 2 },
            ],
          });
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'create() and update() on a relation the parent holds the key for write both tables and link the parent',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { comments } = collectionsOf(runtime);

          const created = await comments.create({
            body: 'Seen it',
            task: (task) => task.variant('feature').create(darkMode),
          });
          const updated = await comments.where({ id: 1 }).update({
            task: (task) => task.variant('feature').create([exportPdf]),
          });

          expect([created, updated]).toEqual([
            { id: 1, body: 'Seen it', taskId: 1 },
            { id: 1, body: 'Seen it', taskId: 2 },
          ]);
          expect(await storedFeatures(runtime)).toEqual({
            tasks: [
              { id: 1, title: 'Dark mode', type: 'feature', project_id: null },
              { id: 2, title: 'Export to PDF', type: 'feature', project_id: null },
            ],
            features: [
              { id: 1, priority: 1 },
              { id: 2, priority: 3 },
            ],
          });
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'create() and update() on a relation through a junction write both tables and link each row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { labels } = collectionsOf(runtime);

          const created = await labels.create({
            name: 'ui',
            tasks: (tasks) => tasks.variant('feature').create([darkMode, exportPdf]),
          });
          const updated = await labels.where({ id: 1 }).update({
            tasks: (tasks) => tasks.variant('feature').create(search),
          });

          expect([created, updated]).toEqual([
            { id: 1, name: 'ui' },
            { id: 1, name: 'ui' },
          ]);
          expect(await storedFeatures(runtime)).toEqual({
            tasks: [
              { id: 1, title: 'Dark mode', type: 'feature', project_id: null },
              { id: 2, title: 'Export to PDF', type: 'feature', project_id: null },
              { id: 3, title: 'Search', type: 'feature', project_id: null },
            ],
            features: [
              { id: 1, priority: 1 },
              { id: 2, priority: 3 },
              { id: 3, priority: 2 },
            ],
          });
          expect(
            await runtime.query('select label_id, task_id from task_labels order by task_id'),
          ).toEqual([
            { label_id: 1, task_id: 1 },
            { label_id: 1, task_id: 2 },
            { label_id: 1, task_id: 3 },
          ]);
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'writes no row of either table when a later row of the call fails',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects } = collectionsOf(runtime);

          expect(
            await rejectionShape(
              projects.create({
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
            constraint: 'tasks_pkey',
            detail: 'Key (id)=(7) already exists.',
            message: 'duplicate key value violates unique constraint "tasks_pkey"',
          });

          expect(await runtime.query('select id from projects_tbl')).toEqual([]);
          expect(await storedFeatures(runtime)).toEqual({ tasks: [], features: [] });
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses a relation callback in the row with the error of the top-level variant create',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await setupSchema(runtime);
          const { projects, tasks } = collectionsOf(runtime);

          const topLevel = await tasks
            .variant('feature')
            .create({
              ...darkMode,
              comments: (comments) => comments.create({ body: 'Seen it' }),
            })
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          const nested = await projects
            .create({
              name: 'Launch',
              tasks: (related) =>
                related.variant('feature').create({
                  ...darkMode,
                  comments: (comments) => comments.create({ body: 'Seen it' }),
                }),
            })
            .then(
              () => undefined,
              (error: unknown) => error,
            );

          expect(topLevel).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
          expect(nested).toEqual(topLevel);
          expect(await runtime.query('select id from projects_tbl')).toEqual([]);
          expect(await storedFeatures(runtime)).toEqual({ tasks: [], features: [] });
        }, polyContext.contract);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
