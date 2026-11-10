import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const polyContext = getPolyTestContext();

function tasksOf(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: polyContext }, 'Task', { namespaceId: 'public' });
}

async function setupVariantAssigneeSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists task_comments');
  await runtime.query('drop table if exists epics');
  await runtime.query('drop table if exists features');
  await runtime.query('drop table if exists tasks');
  await runtime.query('drop table if exists people');
  await runtime.query(`
    create table people (
      id integer primary key,
      name text not null
    )
  `);
  await runtime.query(`
    create table tasks (
      id integer primary key,
      title text not null,
      type text not null,
      severity text,
      project_id integer,
      reporter_id integer,
      bug_assignee_person_id integer references people(id)
    )
  `);
  await runtime.query(`
    create table features (
      id integer primary key references tasks(id),
      priority integer not null,
      feature_assignee_person_id integer references people(id)
    )
  `);
  await runtime.query("insert into people (id, name) values (101, 'Ada'), (102, 'Grace')");
  await runtime.query(`
    insert into tasks (id, title, type, severity, bug_assignee_person_id)
    values
      (1, 'Crash', 'bug', 'critical', 101),
      (2, 'Layout glitch', 'bug', 'minor', null),
      (3, 'Dark mode', 'feature', null, null),
      (4, 'Audit log', 'feature', null, null)
  `);
  await runtime.query(`
    insert into features (id, priority, feature_assignee_person_id)
    values
      (3, 7, 102),
      (4, 3, null)
  `);
}

describe('integration/polymorphism-variant-include-relationships', () => {
  it(
    'an STI Bug includes its variant-declared assignee from the tasks table',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupVariantAssigneeSchema(runtime);

        const rows = await tasksOf(runtime)
          .variant('bug')
          .select('id', 'title', 'type')
          .orderBy((task) => task.id.asc())
          .include('assignee', (person) => person.select('id', 'name'))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Crash',
            type: 'bug',
            assignee: { id: 101, name: 'Ada' },
          },
          {
            id: 2,
            title: 'Layout glitch',
            type: 'bug',
            assignee: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI Feature includes its variant-declared assignee from the features table',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupVariantAssigneeSchema(runtime);

        const rows = await tasksOf(runtime)
          .variant('feature')
          .select('id', 'title', 'type')
          .orderBy((task) => task.id.asc())
          .include('assignee', (person) => person.select('id', 'name'))
          .all();

        expect(rows).toEqual([
          {
            id: 3,
            title: 'Dark mode',
            type: 'feature',
            assignee: { id: 102, name: 'Grace' },
          },
          {
            id: 4,
            title: 'Audit log',
            type: 'feature',
            assignee: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
