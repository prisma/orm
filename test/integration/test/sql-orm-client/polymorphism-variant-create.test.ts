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
  await runtime.query(`
    create table epics (
      id integer primary key references tasks(id),
      scope text not null
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
            priority: 1,
            assigneeId: null,
          },
          {
            id: 2,
            title: 'Export to PDF',
            type: 'feature',
            projectId: null,
            reporterId: null,
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
