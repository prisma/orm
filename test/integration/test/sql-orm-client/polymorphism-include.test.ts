import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  getTestContext,
  type TestContract,
} from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

// The poly contracts are patched in at runtime, so the parent models
// (`Account` / `Project`) and their polymorphic-target relations are
// absent from the static `TestContract` Models type. These minimal
// surfaces let the tests drive `.include('<polyRel>')` and read the
// included rows without a static contract for the patched models. This
// mirrors the cast pattern the unit `collection-variant.test.ts` uses.
//
// `select` / `orderBy` mirror the real `Collection` API idiom
// (`.select('id', 'name').orderBy((row) => row.id.asc())`) so the asserted
// shape is intentional and stable when new model fields are added.
interface OrderBy {
  asc(): unknown;
  desc(): unknown;
}
interface ScalarFilter extends OrderBy {
  eq(value: unknown): unknown;
  gte(value: unknown): unknown;
}
interface RefinementRow {
  id: OrderBy;
}
interface TaskRefinementRow extends RefinementRow {
  severity: ScalarFilter;
  priority: ScalarFilter;
}
interface PolyIncludeRefinement {
  variant(name: string): PolyIncludeRefinement;
  where(predicate: (row: TaskRefinementRow) => unknown): PolyIncludeRefinement;
  select(...fields: string[]): PolyIncludeRefinement;
  orderBy(selector: (row: TaskRefinementRow) => unknown): PolyIncludeRefinement;
}
interface ParentRow {
  id: OrderBy;
}
interface PolyIncludeParent {
  select(...fields: string[]): PolyIncludeParent;
  orderBy(selector: (row: ParentRow) => unknown): PolyIncludeParent;
  include(
    relation: string,
    refine?: (collection: PolyIncludeRefinement) => PolyIncludeRefinement,
  ): {
    all(): AsyncIterableResult<Record<string, unknown>>;
  };
}

// Build the parent-bearing poly contracts locally rather than widening the
// shared `buildStiPolyContract` / `buildMixedPolyContract` helpers: a parent
// relation + FK column on the poly child is only needed by these
// include-against-a-poly-target tests, and adding it to the shared helpers
// breaks sibling tests whose hand-rolled DDL omits the FK column. This is the
// "standalone poly fixture, shared contract stays stable" position.
type RawContract = {
  domain: { namespaces: Record<string, { models: Record<string, MutableModel> }> };
  storage: {
    namespaces: Record<string, { entries: { table: Record<string, RawTable> } }>;
  };
};
type MutableModel = {
  fields: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: { table: string; fields: Record<string, { column: string }> };
};
type RawTable = {
  columns: Record<string, unknown>;
  primaryKey: { columns: string[] };
  uniques: never[];
  indexes: never[];
  foreignKeys: never[];
};

function rawOf(contract: TestContract): RawContract {
  return JSON.parse(JSON.stringify(contract)) as RawContract;
}

function modelsOf(raw: RawContract): Record<string, MutableModel> {
  return raw.domain.namespaces['public']!.models;
}

// Index `public` explicitly rather than the first namespace: the storage
// envelope now also carries an `__unbound__` namespace (TML-2808), which
// sorts ahead of `public` and would otherwise shadow it.
function tablesOf(raw: RawContract): Record<string, RawTable> {
  return raw.storage.namespaces['public']!.entries.table;
}

// Account (parent) --members(1:N)--> User (STI poly target).
function buildStiIncludeContract(): TestContract {
  const raw = rawOf(buildStiPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const user = models['User']!;
  user.fields['accountId'] = { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
  user.storage.fields['accountId'] = { column: 'account_id' };
  tables['users']!.columns['account_id'] = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: true,
  };

  models['Account'] = {
    fields: {
      id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      members: {
        to: { model: 'User', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['accountId'] },
      },
    },
    storage: { table: 'accounts', fields: { id: { column: 'id' }, name: { column: 'name' } } },
  };
  tables['accounts'] = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Project (parent) --tasks(1:N)--> Task (Bug STI / Feature MTI poly target).
function buildMtiIncludeContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.fields['projectId'] = { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
  task.storage.fields['projectId'] = { column: 'project_id' };
  tables['tasks']!.columns['project_id'] = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: true,
  };

  models['Project'] = {
    fields: {
      id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      tasks: {
        to: { model: 'Task', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['projectId'] },
      },
    },
    storage: { table: 'projects_tbl', fields: { id: { column: 'id' }, name: { column: 'name' } } },
  };
  tables['projects_tbl'] = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

function createAccountCollection(runtime: PgIntegrationRuntime): PolyIncludeParent {
  const contract = buildStiIncludeContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Account' as never, {
    namespaceId: 'public',
  }) as unknown as PolyIncludeParent;
}

function createProjectCollection(runtime: PgIntegrationRuntime): PolyIncludeParent {
  const contract = buildMtiIncludeContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Project' as never, {
    namespaceId: 'public',
  }) as unknown as PolyIncludeParent;
}

interface RootTaskCollection {
  variant(name: string): RootTaskCollection;
  select(...fields: string[]): RootTaskCollection;
  orderBy(selector: (row: TaskRefinementRow) => unknown): RootTaskCollection;
  all(): AsyncIterableResult<Record<string, unknown>>;
}

function createTaskCollection(runtime: PgIntegrationRuntime): RootTaskCollection {
  const contract = buildMtiIncludeContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Task' as never, {
    namespaceId: 'public',
  }) as unknown as RootTaskCollection;
}

async function setupStiIncludeSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists users');
  await runtime.query('drop table if exists accounts');

  await runtime.query(`
    create table accounts (
      id integer primary key,
      name text not null
    )
  `);
  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null,
      invited_by_id integer,
      address jsonb,
      kind text not null,
      role text,
      plan text,
      account_id integer
    )
  `);
}

async function seedStiIncludeData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query("insert into accounts (id, name) values (1, 'Acme')");
  await runtime.query("insert into accounts (id, name) values (2, 'Empty')");
  await runtime.query(
    "insert into users (id, name, email, kind, role, account_id) values (1, 'Ada', 'ada@x', 'admin', 'superadmin', 1)",
  );
  await runtime.query(
    "insert into users (id, name, email, kind, plan, account_id) values (2, 'Bob', 'bob@x', 'regular', 'free', 1)",
  );
  await runtime.query(
    "insert into users (id, name, email, kind, role, account_id) values (3, 'Cal', 'cal@x', 'admin', 'auditor', 1)",
  );
}

async function setupMtiIncludeSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists features');
  await runtime.query('drop table if exists tasks');
  await runtime.query('drop table if exists projects_tbl');

  await runtime.query(`
    create table projects_tbl (
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
      project_id integer
    )
  `);
  await runtime.query(`
    create table features (
      id integer primary key references tasks(id),
      priority integer not null
    )
  `);
}

async function seedMtiIncludeData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
  await runtime.query("insert into projects_tbl (id, name) values (2, 'Empty')");
  await runtime.query(
    "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash on login', 'bug', 'critical', 1)",
  );
  await runtime.query(
    "insert into tasks (id, title, type, severity, project_id) values (2, 'Null ref', 'bug', 'low', 1)",
  );
  await runtime.query(
    "insert into tasks (id, title, type, project_id) values (3, 'Dark mode', 'feature', 1)",
  );
  await runtime.query('insert into features (id, priority) values (3, 1)');
  await runtime.query(
    "insert into tasks (id, title, type, project_id) values (4, 'Export PDF', 'feature', 1)",
  );
  await runtime.query('insert into features (id, priority) values (4, 3)');
}

describe('integration/polymorphism-include', () => {
  it(
    'STI-target include returns each child row shaped per its discriminator variant',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupStiIncludeSchema(runtime);
        await seedStiIncludeData(runtime);

        const accounts = createAccountCollection(runtime);
        // `select(['id','kind','role','plan'])` projects all four base columns
        // (STI variant fields are base-table columns); `mapPolymorphicRow`
        // then drops the sibling-variant field per row by the discriminator —
        // admin rows carry `role` (no `plan`), regular rows carry `plan`
        // (no `role`).
        const rows = await accounts
          .select('id', 'name')
          .orderBy((account) => account.id.asc())
          .include('members', (members) =>
            members.select('id', 'kind', 'role', 'plan').orderBy((member) => member.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Acme',
            members: [
              { id: 1, kind: 'admin', role: 'superadmin' },
              { id: 2, kind: 'regular', plan: 'free' },
              { id: 3, kind: 'admin', role: 'auditor' },
            ],
          },
          { id: 2, name: 'Empty', members: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'MTI-target include applies explicit selection and preserves the implicit default',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        const implicitRows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
          .all();

        expect(implicitRows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              {
                id: 1,
                title: 'Crash on login',
                type: 'bug',
                severity: 'critical',
                projectId: 1,
              },
              { id: 2, title: 'Null ref', type: 'bug', severity: 'low', projectId: 1 },
              { id: 3, title: 'Dark mode', type: 'feature', priority: 1, projectId: 1 },
              { id: 4, title: 'Export PDF', type: 'feature', priority: 3, projectId: 1 },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);

        const selectedRows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) => tasks.select('id', 'title').orderBy((task) => task.id.asc()))
          .all();

        expect(selectedRows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 1, title: 'Crash on login' },
              { id: 2, title: 'Null ref' },
              { id: 3, title: 'Dark mode' },
              { id: 4, title: 'Export PDF' },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);

        const selectedWithDiscriminatorRows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks.select('id', 'title', 'type').orderBy((task) => task.id.asc()),
          )
          .all();

        expect(selectedWithDiscriminatorRows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 1, title: 'Crash on login', type: 'bug' },
              { id: 2, title: 'Null ref', type: 'bug' },
              { id: 3, title: 'Dark mode', type: 'feature' },
              { id: 4, title: 'Export PDF', type: 'feature' },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);

        const selectedMtiRows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks.select('id', 'priority').orderBy((task) => task.id.asc()),
          )
          .all();

        expect(selectedMtiRows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [{ id: 1 }, { id: 2 }, { id: 3, priority: 1 }, { id: 4, priority: 3 }],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an STI variant-specific where on a poly include refinement filters by the variant field',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // `severity` is the Bug variant's discriminating field. Filtering an
        // STI-variant-narrowed include on it confirms the refinement's where
        // is scoped to the joined child rows and filters per the variant field.
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Bug')
              .where((task) => task.severity.eq('critical'))
              .select('id', 'title', 'type', 'severity')
              .orderBy((task) => task.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [{ id: 1, title: 'Crash on login', type: 'bug', severity: 'critical' }],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant-specific where on a poly include refinement filters by the variant table column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // The filter still requires the joined MTI table, but the explicit
        // selection controls which fields reach the returned row.
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Feature')
              .where((task) => task.priority.gte(3))
              .select('id', 'title', 'type')
              .orderBy((task) => task.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [{ id: 4, title: 'Export PDF', type: 'feature' }],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant-narrowed include returns only that variant with the selected shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Feature')
              .select('id', 'title', 'type')
              .orderBy((task) => task.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 3, title: 'Dark mode', type: 'feature' },
              { id: 4, title: 'Export PDF', type: 'feature' },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'root MTI collection applies explicit selection and preserves the implicit default',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const tasks = createTaskCollection(runtime);
        const implicitRows = await tasks.orderBy((task) => task.id.asc()).all();

        expect(implicitRows).toEqual([
          {
            id: 1,
            title: 'Crash on login',
            type: 'bug',
            severity: 'critical',
            projectId: 1,
          },
          { id: 2, title: 'Null ref', type: 'bug', severity: 'low', projectId: 1 },
          { id: 3, title: 'Dark mode', type: 'feature', priority: 1, projectId: 1 },
          { id: 4, title: 'Export PDF', type: 'feature', priority: 3, projectId: 1 },
        ]);

        const selectedRows = await tasks
          .select('id', 'title')
          .orderBy((task) => task.id.asc())
          .all();

        expect(selectedRows).toEqual([
          { id: 1, title: 'Crash on login' },
          { id: 2, title: 'Null ref' },
          { id: 3, title: 'Dark mode' },
          { id: 4, title: 'Export PDF' },
        ]);

        const selectedWithDiscriminatorRows = await tasks
          .select('id', 'title', 'type')
          .orderBy((task) => task.id.asc())
          .all();

        expect(selectedWithDiscriminatorRows).toEqual([
          { id: 1, title: 'Crash on login', type: 'bug' },
          { id: 2, title: 'Null ref', type: 'bug' },
          { id: 3, title: 'Dark mode', type: 'feature' },
          { id: 4, title: 'Export PDF', type: 'feature' },
        ]);

        const selectedMtiRows = await tasks
          .select('id', 'priority')
          .orderBy((task) => task.id.asc())
          .all();

        expect(selectedMtiRows).toEqual([
          { id: 1 },
          { id: 2 },
          { id: 3, priority: 1 },
          { id: 4, priority: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a root MTI variant-narrowed orderBy sorts by the variant table column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const tasks = createTaskCollection(runtime);
        // `priority` lives on the joined `features` table, not the base
        // `tasks` table. Ordering a root Feature-narrowed collection by it
        // confirms the orderBy selector names the variant column against the
        // joined variant table. Default selection (no `.select(...)`) keeps the
        // assertion on the natural Feature row shape; seed has Feature id=3
        // (priority 1) and id=4 (priority 3), so `priority.desc()` yields 4
        // before 3.
        const rows = await tasks
          .variant('Feature')
          .orderBy((task) => task.priority.desc())
          .all();

        expect(rows).toEqual([
          { id: 4, title: 'Export PDF', type: 'feature', priority: 3, projectId: 1 },
          { id: 3, title: 'Dark mode', type: 'feature', priority: 1, projectId: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant-specific orderBy on a poly include refinement sorts by the variant table column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // Mirror of the root case inside an include refinement: the refined
        // child collection is narrowed to Feature and ordered by the MTI
        // variant column `priority` (joined from `features`). Default selection
        // on the child keeps the natural Feature row shape; the two Feature
        // tasks come back ordered priority-descending (id 4 before id 3).
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks.variant('Feature').orderBy((task) => task.priority.desc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 4, title: 'Export PDF', type: 'feature', priority: 3, projectId: 1 },
              { id: 3, title: 'Dark mode', type: 'feature', priority: 1, projectId: 1 },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an STI-target variant-narrowed include returns only that variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupStiIncludeSchema(runtime);
        await seedStiIncludeData(runtime);

        const accounts = createAccountCollection(runtime);
        const rows = await accounts
          .select('id', 'name')
          .orderBy((account) => account.id.asc())
          .include('members', (members) =>
            members
              .variant('Admin')
              .select('id', 'kind', 'role')
              .orderBy((member) => member.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Acme',
            members: [
              { id: 1, kind: 'admin', role: 'superadmin' },
              { id: 3, kind: 'admin', role: 'auditor' },
            ],
          },
          { id: 2, name: 'Empty', members: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
