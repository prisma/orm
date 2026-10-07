import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const polyContext = getPolyTestContext();

// These tests run against the REAL emitted poly fixture
// (`fixtures/polymorphism/generated/contract.json`): the Task hierarchy — base
// `Task` (discriminator `type`), `Bug` (single-table inheritance, own field
// `severity`), `Feature` (multi-table inheritance, table `features`, field
// `priority`) — is part of the static contract type, so `.variant(...)`,
// `.orderBy(...)`, `.create(...)` and the decoded row shapes are driven by the
// real `Collection` types, not a hand-written cast interface.
//
// The fixture's hierarchy carries the relationship FK columns (`project_id`,
// `reporter_id`, and the variant-owned assignee columns) that the sibling include
// tests need; they are nullable and surface in the default (no-`select`)
// projection here as `projectId`, `reporterId`, and variant-scoped `assigneeId`.

function createTaskCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: polyContext }, 'Task', { namespaceId: 'public' });
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

  // The shared fixture's Task hierarchy includes a second MTI variant (Epic →
  // `epics`). A base `Task` query LEFT JOINs every MTI variant table, so the
  // table must exist even though these scenarios seed no epics.
  await runtime.query(`
    create table epics (
      id integer primary key references tasks(id),
      scope text not null
    )
  `);
}

async function seedPolyData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(
    "insert into tasks (id, title, type, severity) values (1, 'Crash on login', 'bug', 'critical')",
  );
  await runtime.query(
    "insert into tasks (id, title, type, severity) values (2, 'Null ref in parser', 'bug', 'low')",
  );
  await runtime.query("insert into tasks (id, title, type) values (3, 'Dark mode', 'feature')");
  await runtime.query('insert into features (id, priority) values (3, 1)');
  await runtime.query("insert into tasks (id, title, type) values (4, 'Export to PDF', 'feature')");
  await runtime.query('insert into features (id, priority) values (4, 3)');
}

describe('integration/polymorphism', () => {
  it(
    'base query with no select returns the full default shape per variant of the union',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        // No `.select(...)` on purpose: this pins the default projection of a
        // base poly query — each row carries the base fields plus only its own
        // variant's field (Bug rows carry `severity`, Feature rows carry
        // `priority`; no sibling-variant field leaks).
        const rows = await tasks
          .orderBy((task) => task.id.asc())
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Crash on login',
            type: 'bug',
            projectId: null,
            reporterId: null,
            severity: 'critical',
            assigneeId: null,
          },
          {
            id: 2,
            title: 'Null ref in parser',
            type: 'bug',
            projectId: null,
            reporterId: null,
            severity: 'low',
            assigneeId: null,
          },
          {
            id: 3,
            title: 'Dark mode',
            type: 'feature',
            projectId: null,
            reporterId: null,
            priority: 1,
            assigneeId: null,
          },
          {
            id: 4,
            title: 'Export to PDF',
            type: 'feature',
            projectId: null,
            reporterId: null,
            priority: 3,
            assigneeId: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'variant(Bug) query with no select returns the full default STI variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        // STI variant (`severity` is a base-table column). No `.select(...)`:
        // pins the default projection of an STI-variant-narrowed query — base
        // fields plus the Bug variant's `severity`, and only the Bug rows.
        const bugs = await tasks
          .variant('bug')
          .orderBy((task) => task.id.asc())
          .all()
          .toArray();

        expect(bugs).toEqual([
          {
            id: 1,
            title: 'Crash on login',
            type: 'bug',
            projectId: null,
            reporterId: null,
            severity: 'critical',
            assigneeId: null,
          },
          {
            id: 2,
            title: 'Null ref in parser',
            type: 'bug',
            projectId: null,
            reporterId: null,
            severity: 'low',
            assigneeId: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'variant(Feature) query with no select INNER JOINs and returns the full default MTI variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        // MTI variant (`priority` lives on the joined `features` table). No
        // `.select(...)`: pins the default projection of an MTI-variant-narrowed
        // query — base fields plus the joined `priority`, and only the Feature
        // rows (the INNER JOIN drops non-Feature rows).
        const features = await tasks
          .variant('feature')
          .orderBy((task) => task.id.asc())
          .all()
          .toArray();

        expect(features).toEqual([
          {
            id: 3,
            title: 'Dark mode',
            type: 'feature',
            projectId: null,
            reporterId: null,
            priority: 1,
            assigneeId: null,
          },
          {
            id: 4,
            title: 'Export to PDF',
            type: 'feature',
            projectId: null,
            reporterId: null,
            priority: 3,
            assigneeId: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'STI variant create auto-injects discriminator and returns mapped row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const tasks = createTaskCollection(runtime);
        const bugs = tasks.variant('bug');
        const created = await bugs.create({ title: 'New bug', severity: 'high', assigneeId: 17 });

        const id = created.id;
        expect(created).toEqual({
          id,
          title: 'New bug',
          type: 'bug',
          projectId: null,
          reporterId: null,
          severity: 'high',
          assigneeId: 17,
        });

        // Read the row back through the ORM (no select → default variant shape)
        // rather than re-reading the discriminator column raw: the discriminator
        // round-trips through the mapped variant shape, which is what callers see.
        const readBack = await tasks
          .variant('bug')
          .orderBy((task) => task.id.asc())
          .all()
          .toArray();
        expect(readBack).toEqual([
          {
            id,
            title: 'New bug',
            type: 'bug',
            projectId: null,
            reporterId: null,
            severity: 'high',
            assigneeId: 17,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'MTI variant create inserts into both tables within a transaction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const tasks = createTaskCollection(runtime);
        const features = tasks.variant('feature');
        const created = await features.create({
          title: 'New feature',
          priority: 5,
        });

        const id = created.id;
        expect(created).toEqual({
          id,
          title: 'New feature',
          type: 'feature',
          projectId: null,
          reporterId: null,
          priority: 5,
          assigneeId: null,
        });

        // Storage-level invariant the ORM intentionally hides: an MTI create is a
        // two-table transactional write — the base row lands in `tasks` and the
        // variant row in `features`. The mapped ORM result above presents a single
        // merged row, so only a raw read can prove both physical tables were
        // written. This is the deliberate exception to "read back through the ORM".
        const baseRows = await runtime.query<{ title: string; type: string }>(
          'select title, type from tasks where id = $1',
          [id],
        );
        expect(baseRows).toEqual([{ title: 'New feature', type: 'feature' }]);

        const variantRows = await runtime.query<{ priority: number }>(
          'select priority from features where id = $1',
          [id],
        );
        expect(variantRows).toEqual([{ priority: 5 }]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
