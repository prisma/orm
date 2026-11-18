import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext, type IncludeStrategy, includeStrategies } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

// These tests run against the REAL emitted poly fixture
// (`fixtures/polymorphism/generated/contract.json`), which carries two
// polymorphic hierarchies and the parent/relation models these scenarios need:
//   1. a poly (MTI) model as the include PARENT (poly model is the root);
//   2. a to-one / N:1 include whose TARGET is a poly model;
//   3. a base with two MTI variant tables (no cross-variant contamination);
//   4. a nested include through a poly target (Parent -> tasks(poly) -> child);
//   5. relationship-level implicit-default selection (no `.select(...)`).
//
// Because the models are part of the static contract type, `.include(...)`,
// `.variant(...)`, `.select(...)` and the decoded row shapes are driven by the
// real `Collection` types — no runtime contract patching, no cast stand-in
// interfaces. The fixture's `Task` carries `projectId` / `reporterId` (the FK
// columns these relations need); they are nullable base columns and surface in
// the default (no-`select`) poly projection below.
//
// Ordering is ALWAYS by a base-table column (`id`): TML-2782 makes orderBy on
// an MTI variant column throw. Poly result columns are asserted at their
// CURRENT behavior — explicit `.select(...)` does not restrict MTI variant
// columns (TML-2783) — so the no-select implicit-default shape is the primary
// vehicle for poly result assertions here.

function collectionOf<M extends 'Task' | 'Ticket' | 'Project' | 'Account'>(
  runtime: PgIntegrationRuntime,
  model: M,
  strategy: IncludeStrategy,
) {
  return new Collection({ runtime, context: getPolyTestContext(strategy) }, model, {
    namespaceId: 'public',
  });
}

async function createTasksTable(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(`
    create table tasks (
      id integer primary key,
      title text not null,
      type text not null,
      severity text,
      bug_assignee_person_id integer,
      project_id integer,
      reporter_id integer,
      pinned_by_id integer unique
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

async function createUsersTable(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null,
      kind text not null,
      role text,
      plan text,
      account_id integer
    )
  `);
}

describe.each(includeStrategies)(
  'integration/polymorphism-include-relationships (%s)',
  (strategy) => {
    it(
      'a poly (MTI) parent correlates its child relation across base + variant tables',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists task_comments');
          await runtime.query('drop table if exists epics');
          await runtime.query('drop table if exists features');
          await runtime.query('drop table if exists tasks');
          await createTasksTable(runtime);
          await runtime.query(`
          create table task_comments (
            id integer primary key,
            body text not null,
            task_id integer
          )
        `);
          await runtime.query(
            "insert into tasks (id, title, type, severity) values (1, 'Crash', 'bug', 'critical')",
          );
          await runtime.query(
            "insert into tasks (id, title, type) values (2, 'Dark mode', 'feature')",
          );
          await runtime.query('insert into features (id, priority) values (2, 5)');
          await runtime.query(
            "insert into task_comments (id, body, task_id) values (10, 'repro attached', 1)",
          );
          await runtime.query(
            "insert into task_comments (id, body, task_id) values (11, 'ship it', 2)",
          );
          await runtime.query(
            "insert into task_comments (id, body, task_id) values (12, 'me too', 1)",
          );

          const tasks = collectionOf(runtime, 'Task', strategy);
          runtime.resetExecutions();
          const rows = await tasks
            .orderBy((task) => task.id.asc())
            .include('comments', (comments) =>
              comments.select('id', 'body', 'taskId').orderBy((comment) => comment.id.asc()),
            )
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          // The bug row (base-only) and the feature row (base + features variant
          // table) each correlate their `comments` by the base `id`. No-select on
          // the poly ROOT yields the full default per-variant shape: the bug row
          // carries `severity`, the feature row carries `priority` (TML-2783).
          expect(rows).toEqual([
            {
              id: 1,
              title: 'Crash',
              type: 'bug',
              projectId: null,
              reporterId: null,
              pinnedById: null,
              assigneeId: null,
              severity: 'critical',
              comments: [
                { id: 10, body: 'repro attached', taskId: 1 },
                { id: 12, body: 'me too', taskId: 1 },
              ],
            },
            {
              id: 2,
              title: 'Dark mode',
              type: 'feature',
              projectId: null,
              reporterId: null,
              pinnedById: null,
              assigneeId: null,
              priority: 5,
              comments: [{ id: 11, body: 'ship it', taskId: 2 }],
            },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a to-one (N:1) include whose target is a poly model variant-maps the single object',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists tickets');
          await runtime.query('drop table if exists users');
          await createUsersTable(runtime);
          await runtime.query(`
          create table tickets (
            id integer primary key,
            subject text not null,
            owner_id integer
          )
        `);
          await runtime.query(
            "insert into users (id, name, email, kind, role) values (1, 'Ada', 'ada@x', 'admin', 'superadmin')",
          );
          await runtime.query(
            "insert into users (id, name, email, kind, plan) values (2, 'Bob', 'bob@x', 'regular', 'free')",
          );
          await runtime.query(
            "insert into tickets (id, subject, owner_id) values (100, 'Login broken', 1)",
          );
          await runtime.query(
            "insert into tickets (id, subject, owner_id) values (101, 'Add export', 2)",
          );
          await runtime.query(
            "insert into tickets (id, subject, owner_id) values (102, 'Orphan', null)",
          );

          const tickets = collectionOf(runtime, 'Ticket', strategy);
          runtime.resetExecutions();
          const rows = await tickets
            .select('id', 'subject')
            .orderBy((ticket) => ticket.id.asc())
            .include('owner')
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          // `owner` is a single object (or null), not an array. Each owner is
          // variant-mapped: the admin carries `role`, the regular carries `plan`.
          expect(rows).toEqual([
            {
              id: 100,
              subject: 'Login broken',
              owner: {
                id: 1,
                name: 'Ada',
                email: 'ada@x',
                kind: 'admin',
                accountId: null,
                role: 'superadmin',
              },
            },
            {
              id: 101,
              subject: 'Add export',
              owner: {
                id: 2,
                name: 'Bob',
                email: 'bob@x',
                kind: 'regular',
                accountId: null,
                plan: 'free',
              },
            },
            { id: 102, subject: 'Orphan', owner: null },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a base with two MTI variant tables surfaces only the matching variant column per row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists epics');
          await runtime.query('drop table if exists features');
          await runtime.query('drop table if exists tasks');
          await runtime.query('drop table if exists projects_tbl');
          await runtime.query(`
          create table projects_tbl (
            id integer primary key,
            name text not null
          )
        `);
          await createTasksTable(runtime);
          await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
          await runtime.query(
            "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash', 'bug', 'critical', 1)",
          );
          await runtime.query(
            "insert into tasks (id, title, type, project_id) values (2, 'Dark mode', 'feature', 1)",
          );
          await runtime.query('insert into features (id, priority) values (2, 3)');
          await runtime.query(
            "insert into tasks (id, title, type, project_id) values (3, 'Billing', 'epic', 1)",
          );
          await runtime.query("insert into epics (id, scope) values (3, 'Q3')");

          const projects = collectionOf(runtime, 'Project', strategy);
          runtime.resetExecutions();
          const rows = await projects
            .select('id', 'name')
            .orderBy((project) => project.id.asc())
            .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          // No-select on the poly include → full default per-variant shape.
          // The bug row carries `severity`, the feature row carries `priority`
          // (from `features`), the epic row carries `scope` (from `epics`). No
          // row carries a sibling variant's column — no cross-variant
          // contamination across the two MTI variant tables.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Roadmap',
              tasks: [
                {
                  id: 1,
                  title: 'Crash',
                  type: 'bug',
                  projectId: 1,
                  reporterId: null,
                  pinnedById: null,
                  assigneeId: null,
                  severity: 'critical',
                },
                {
                  id: 2,
                  title: 'Dark mode',
                  type: 'feature',
                  projectId: 1,
                  reporterId: null,
                  pinnedById: null,
                  assigneeId: null,
                  priority: 3,
                },
                {
                  id: 3,
                  title: 'Billing',
                  type: 'epic',
                  projectId: 1,
                  reporterId: null,
                  pinnedById: null,
                  scope: 'Q3',
                },
              ],
            },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );

    // A nested `.include('reporter')` hanging off a polymorphic include TARGET
    // used to decode to `null` for every row, regardless of data: `mapPolymorphicRow`
    // (`collection-runtime.ts`) keeps only base/variant MODEL-field columns, so the
    // nested-include payload column (`reporter`) was dropped before
    // `decodeIncludePayload` (`collection-dispatch.ts`) read it back at the mapped
    // row. The fix sources each nested-include payload from the RAW child row, which
    // always carries the relation alias. This test asserts the CORRECT (stitched)
    // shape; do not weaken it to match the old bug.
    it(
      'a nested include through a poly target stitches the grandchild on variant-mapped rows',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists epics');
          await runtime.query('drop table if exists features');
          await runtime.query('drop table if exists tasks');
          await runtime.query('drop table if exists people');
          await runtime.query('drop table if exists projects_tbl');
          await runtime.query(`
          create table projects_tbl (
            id integer primary key,
            name text not null
          )
        `);
          await runtime.query(`
          create table people (
            id integer primary key,
            name text not null
          )
        `);
          await createTasksTable(runtime);
          await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
          await runtime.query("insert into people (id, name) values (50, 'Ada')");
          await runtime.query("insert into people (id, name) values (51, 'Bob')");
          await runtime.query(
            "insert into tasks (id, title, type, severity, project_id, reporter_id) values (1, 'Crash', 'bug', 'critical', 1, 50)",
          );
          await runtime.query(
            "insert into tasks (id, title, type, project_id, reporter_id) values (2, 'Dark mode', 'feature', 1, 51)",
          );
          await runtime.query('insert into features (id, priority) values (2, 7)');

          const projects = collectionOf(runtime, 'Project', strategy);
          runtime.resetExecutions();
          const rows = await projects
            .select('id', 'name')
            .orderBy((project) => project.id.asc())
            .include('tasks', (tasks) =>
              tasks
                .orderBy((task) => task.id.asc())
                .include('reporter', (reporter) => reporter.select('id', 'name')),
            )
            .all();
          expectPerRelationStatements(runtime, strategy, 3);

          // The poly child rows are variant-mapped (bug carries `severity`,
          // feature carries `priority`) AND each carries the nested `reporter`
          // grandchild stitched by `reporter_id`.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Roadmap',
              tasks: [
                {
                  id: 1,
                  title: 'Crash',
                  type: 'bug',
                  projectId: 1,
                  reporterId: 50,
                  pinnedById: null,
                  assigneeId: null,
                  severity: 'critical',
                  reporter: { id: 50, name: 'Ada' },
                },
                {
                  id: 2,
                  title: 'Dark mode',
                  type: 'feature',
                  projectId: 1,
                  reporterId: 51,
                  pinnedById: null,
                  assigneeId: null,
                  priority: 7,
                  reporter: { id: 51, name: 'Bob' },
                },
              ],
            },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'an STI-target include with no select returns the full default per-variant shape',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists users');
          await runtime.query('drop table if exists accounts');
          await runtime.query(`
          create table accounts (
            id integer primary key,
            name text not null
          )
        `);
          await createUsersTable(runtime);
          await runtime.query("insert into accounts (id, name) values (1, 'Acme')");
          await runtime.query(
            "insert into users (id, name, email, kind, role, account_id) values (1, 'Ada', 'ada@x', 'admin', 'superadmin', 1)",
          );
          await runtime.query(
            "insert into users (id, name, email, kind, plan, account_id) values (2, 'Bob', 'bob@x', 'regular', 'free', 1)",
          );

          const accounts = collectionOf(runtime, 'Account', strategy);
          runtime.resetExecutions();
          const rows = await accounts
            .select('id', 'name')
            .orderBy((account) => account.id.asc())
            .include('members', (members) => members.orderBy((member) => member.id.asc()))
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          // No `.select(...)` on the poly include — the deliberate
          // implicit-default exception in the whole-shape rule. The admin row
          // carries `role` (no `plan`), the regular row carries `plan` (no
          // `role`); both carry the full base shape.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Acme',
              members: [
                {
                  id: 1,
                  name: 'Ada',
                  email: 'ada@x',
                  kind: 'admin',
                  accountId: 1,
                  role: 'superadmin',
                },
                {
                  id: 2,
                  name: 'Bob',
                  email: 'bob@x',
                  kind: 'regular',
                  accountId: 1,
                  plan: 'free',
                },
              ],
            },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'an MTI-target include with no select returns the full default per-variant shape',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await runtime.query('drop table if exists epics');
          await runtime.query('drop table if exists features');
          await runtime.query('drop table if exists tasks');
          await runtime.query('drop table if exists projects_tbl');
          await runtime.query(`
          create table projects_tbl (
            id integer primary key,
            name text not null
          )
        `);
          await createTasksTable(runtime);
          await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
          await runtime.query(
            "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash', 'bug', 'critical', 1)",
          );
          await runtime.query(
            "insert into tasks (id, title, type, project_id) values (2, 'Dark mode', 'feature', 1)",
          );
          await runtime.query('insert into features (id, priority) values (2, 9)');

          const projects = collectionOf(runtime, 'Project', strategy);
          runtime.resetExecutions();
          const rows = await projects
            .select('id', 'name')
            .orderBy((project) => project.id.asc())
            .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          // No `.select(...)` on the poly include — implicit-default exception.
          // The bug row carries `severity`, the feature row carries `priority`
          // (joined from the `features` MTI variant table); neither carries the
          // sibling variant's column.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Roadmap',
              tasks: [
                {
                  id: 1,
                  title: 'Crash',
                  type: 'bug',
                  projectId: 1,
                  reporterId: null,
                  pinnedById: null,
                  assigneeId: null,
                  severity: 'critical',
                },
                {
                  id: 2,
                  title: 'Dark mode',
                  type: 'feature',
                  projectId: 1,
                  reporterId: null,
                  pinnedById: null,
                  assigneeId: null,
                  priority: 9,
                },
              ],
            },
          ]);
        }, getPolyTestContext().contract);
      },
      timeouts.spinUpPpgDev,
    );
  },
);
