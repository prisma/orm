import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const polyContext = getPolyTestContext();

function featuresOf(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: polyContext }, 'Task', {
    namespaceId: 'public',
  }).variant('feature');
}

async function setupPolySchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists features');
  await runtime.query('drop table if exists epics');
  await runtime.query('drop table if exists task_comments');
  await runtime.query('drop table if exists tasks');
  await runtime.query('drop table if exists projects_tbl');
  await runtime.query('create table projects_tbl (id serial primary key, name text not null)');
  await runtime.query(`
    create table tasks (
      id serial primary key,
      title text not null,
      type text not null,
      severity text,
      project_id integer,
      reporter_id integer,
      pinned_by_id integer unique,
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
  await runtime.query(`
    create table epics (
      id integer primary key references tasks(id),
      scope text not null
    )
  `);
  await runtime.query(`
    create table task_comments (
      id serial primary key,
      body text not null,
      task_id integer references tasks(id)
    )
  `);
}

async function storedRows(runtime: PgIntegrationRuntime) {
  return {
    tasks: await runtime.query('select id, title, type from tasks order by id'),
    features: await runtime.query('select id, priority from features order by id'),
  };
}

describe('integration/polymorphism-variant-create', () => {
  it(
    'createAll on a variant in its own table returns each created row and writes both tables',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const created = await featuresOf(runtime).createAll([
          { title: 'Dark mode', priority: 1 },
          { title: 'Export to PDF', priority: 3 },
        ]);

        expect(created).toEqual([
          {
            id: 1,
            title: 'Dark mode',
            type: 'feature',
            projectId: null,
            reporterId: null,
            pinnedById: null,
            priority: 1,
            assigneeId: null,
          },
          {
            id: 2,
            title: 'Export to PDF',
            type: 'feature',
            projectId: null,
            reporterId: null,
            pinnedById: null,
            priority: 3,
            assigneeId: null,
          },
        ]);
        expect(await storedRows(runtime)).toEqual({
          tasks: [
            { id: 1, title: 'Dark mode', type: 'feature' },
            { id: 2, title: 'Export to PDF', type: 'feature' },
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
    'create on a variant in its own table returns only the selected fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        expect(
          await featuresOf(runtime)
            .select('id', 'title')
            .create({ title: 'Dark mode', priority: 1 }),
        ).toEqual({ id: 1, title: 'Dark mode' });
        expect(await storedRows(runtime)).toEqual({
          tasks: [{ id: 1, title: 'Dark mode', type: 'feature' }],
          features: [{ id: 1, priority: 1 }],
        });
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll on a variant in its own table returns only the selected fields of each row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const created = await featuresOf(runtime)
          .select('id', 'title')
          .createAll([
            { title: 'Dark mode', priority: 1 },
            { title: 'Export to PDF', priority: 3 },
          ]);

        expect([...created].sort((left, right) => left.id - right.id)).toEqual([
          { id: 1, title: 'Dark mode' },
          { id: 2, title: 'Export to PDF' },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create on a variant in its own table applies relation callbacks and loads includes',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await runtime.query("insert into projects_tbl (name) values ('Launch')");

        const created = await featuresOf(runtime)
          .select('id', 'title', 'projectId')
          .include('project', (project) => project.select('id', 'name'))
          .include('comments', (comments) => comments.select('body'))
          .create({
            title: 'Dark mode',
            priority: 1,
            project: (project) => project.connect({ id: 1 }),
            comments: (comments) => comments.create([{ body: 'Seen it' }]),
          });

        expect({
          created,
          stored: await storedRows(runtime),
          comments: await runtime.query('select body, task_id from task_comments'),
        }).toEqual({
          created: {
            id: 1,
            title: 'Dark mode',
            projectId: 1,
            project: { id: 1, name: 'Launch' },
            comments: [{ body: 'Seen it' }],
          },
          stored: {
            tasks: [{ id: 1, title: 'Dark mode', type: 'feature' }],
            features: [{ id: 1, priority: 1 }],
          },
          comments: [{ body: 'Seen it', task_id: 1 }],
        });
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create on a variant in its own table writes no row when its relation callback finds no row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        await expect(
          featuresOf(runtime).create({
            title: 'Dark mode',
            priority: 1,
            project: (project) => project.connect({ id: 9 }),
          }),
        ).rejects.toMatchObject({ code: 'ORM.RELATION_ROW_MISSING' });

        expect(await storedRows(runtime)).toEqual({ tasks: [], features: [] });
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll on a variant in its own table creates no row when one of its rows fails',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        await expect(
          featuresOf(runtime).createAll([
            { id: 7, title: 'Dark mode', priority: 1 },
            { id: 7, title: 'Export to PDF', priority: 3 },
          ]),
        ).rejects.toThrow();

        expect(await storedRows(runtime)).toEqual({ tasks: [], features: [] });
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
