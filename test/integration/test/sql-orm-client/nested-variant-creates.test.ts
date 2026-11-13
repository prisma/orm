import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const polyContext = getPolyTestContext();

function collectionsOf(runtime: PgIntegrationRuntime) {
  const collection = <ModelName extends 'Project' | 'TaskComment' | 'Label'>(
    modelName: ModelName,
  ) => new Collection({ runtime, context: polyContext }, modelName, { namespaceId: 'public' });
  return {
    projects: collection('Project'),
    comments: collection('TaskComment'),
    labels: collection('Label'),
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

  it(
    'refuses a variant stored in its own table and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupSchema(runtime);
        const { projects } = collectionsOf(runtime);

        await expect(
          projects.create({
            name: 'Launch',
            tasks: (tasks) => tasks.variant('feature').create({ title: 'Dark mode', priority: 1 }),
          }),
        ).rejects.toMatchObject({ code: 'ORM.OPERATION_UNSUPPORTED' });
        expect(await runtime.query('select id from projects_tbl')).toEqual([]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
