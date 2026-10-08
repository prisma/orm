import postgresAdapter from '@internal/adapter-postgres/runtime';
import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/polymorphism-self-relation/generated/contract';
import contractJson from './fixtures/polymorphism-self-relation/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);
const context: ExecutionContext<Contract> = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

function tasksOf(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
}

async function withTaskTree(
  fn: (runtime: PgIntegrationRuntime, tasks: ReturnType<typeof tasksOf>) => Promise<void>,
): Promise<void> {
  await withPushedContractRuntime(contract, async (runtime) => {
    await runtime.query(`
      insert into tasks (id, title, type, severity, parent_id) values
        (1, 'Launch', 'feature', null, null),
        (2, 'Checkout', 'feature', null, 1),
        (3, 'Crash on pay', 'bug', 'critical', 1),
        (4, 'Typo', 'bug', 'minor', 2),
        (5, 'Backlog', 'feature', null, null)
    `);
    await runtime.query(`
      insert into features (id, priority, blocked_by_id) values
        (1, 10, null),
        (2, 20, 1),
        (5, 50, 3)
    `);
    await fn(runtime, tasksOf(runtime));
  });
}

async function taskTitles(runtime: PgIntegrationRuntime): Promise<readonly unknown[]> {
  return runtime.query('select id, title from tasks order by id');
}

describe('integration/polymorphism-self-relation', () => {
  it(
    'default projection: include() of the same hierarchy decodes MTI variant children through their own table alias',
    async () => {
      await withTaskTree(async (runtime, tasks) => {
        const rows = await tasks
          .orderBy((task) => task.id.asc())
          .include('subtasks', (subtasks) => subtasks.orderBy((subtask) => subtask.id.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Launch',
            type: 'feature',
            parentId: null,
            priority: 10,
            blockedById: null,
            subtasks: [
              {
                id: 2,
                title: 'Checkout',
                type: 'feature',
                parentId: 1,
                priority: 20,
                blockedById: 1,
              },
              { id: 3, title: 'Crash on pay', type: 'bug', parentId: 1, severity: 'critical' },
            ],
          },
          {
            id: 2,
            title: 'Checkout',
            type: 'feature',
            parentId: 1,
            priority: 20,
            blockedById: 1,
            subtasks: [{ id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' }],
          },
          {
            id: 3,
            title: 'Crash on pay',
            type: 'bug',
            parentId: 1,
            severity: 'critical',
            subtasks: [],
          },
          { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor', subtasks: [] },
          {
            id: 5,
            title: 'Backlog',
            type: 'feature',
            parentId: null,
            priority: 50,
            blockedById: 3,
            subtasks: [],
          },
        ]);

        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('"features_2"."priority" AS "features_2__priority"');
        expect(sql).toContain('"tasks_2"."parent_id" = "tasks"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: include() from a selected MTI variant to its own hierarchy keeps parent and child variant rows apart',
    async () => {
      await withTaskTree(async (_runtime, tasks) => {
        const rows = await tasks
          .orderBy((task) => task.id.asc())
          .include('subtasks', (subtasks) => subtasks.orderBy((subtask) => subtask.id.asc()))
          .variant('feature')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Launch',
            type: 'feature',
            parentId: null,
            priority: 10,
            blockedById: null,
            subtasks: [
              {
                id: 2,
                title: 'Checkout',
                type: 'feature',
                parentId: 1,
                priority: 20,
                blockedById: 1,
              },
              { id: 3, title: 'Crash on pay', type: 'bug', parentId: 1, severity: 'critical' },
            ],
          },
          {
            id: 2,
            title: 'Checkout',
            type: 'feature',
            parentId: 1,
            priority: 20,
            blockedById: 1,
            subtasks: [{ id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' }],
          },
          {
            id: 5,
            title: 'Backlog',
            type: 'feature',
            parentId: null,
            priority: 50,
            blockedById: 3,
            subtasks: [],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: include() of a variant-declared relation to the same hierarchy correlates to the parent variant row',
    async () => {
      await withTaskTree(async (runtime, tasks) => {
        const rows = await tasks
          .variant('feature')
          .orderBy((task) => task.id.asc())
          .include('blockedBy')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Launch',
            type: 'feature',
            parentId: null,
            priority: 10,
            blockedById: null,
            blockedBy: null,
          },
          {
            id: 2,
            title: 'Checkout',
            type: 'feature',
            parentId: 1,
            priority: 20,
            blockedById: 1,
            blockedBy: {
              id: 1,
              title: 'Launch',
              type: 'feature',
              parentId: null,
              priority: 10,
              blockedById: null,
            },
          },
          {
            id: 5,
            title: 'Backlog',
            type: 'feature',
            parentId: null,
            priority: 50,
            blockedById: 3,
            blockedBy: {
              id: 3,
              title: 'Crash on pay',
              type: 'bug',
              parentId: 1,
              severity: 'critical',
            },
          },
        ]);

        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('"tasks_2"."id" = "features"."blocked_by_id"');
        expect(sql).toContain('"features_2"."priority" AS "features_2__priority"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAndCount() filtered by a relation over the root table updates only the matching rows',
    async () => {
      await withTaskTree(async (runtime, tasks) => {
        const count = await tasks
          .where((task) => task.subtasks.some((subtask) => subtask.type.eq('bug')))
          .updateAndCount({ title: 'Has bugs' });

        expect(count).toBe(2);
        expect(await taskTitles(runtime)).toEqual([
          { id: 1, title: 'Has bugs' },
          { id: 2, title: 'Has bugs' },
          { id: 3, title: 'Crash on pay' },
          { id: 4, title: 'Typo' },
          { id: 5, title: 'Backlog' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAndCount() on an MTI variant filtered by a relation over the root table updates only the matching rows',
    async () => {
      await withTaskTree(async (runtime, tasks) => {
        const count = await tasks
          .variant('feature')
          .where((task) => task.subtasks.some((subtask) => subtask.type.eq('feature')))
          .updateAndCount({ title: 'Has feature subtasks' });

        expect(count).toBe(1);
        expect(await taskTitles(runtime)).toEqual([
          { id: 1, title: 'Has feature subtasks' },
          { id: 2, title: 'Checkout' },
          { id: 3, title: 'Crash on pay' },
          { id: 4, title: 'Typo' },
          { id: 5, title: 'Backlog' },
        ]);
        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('FROM "public"."tasks" AS "tasks_3"');
        expect(sql).toContain('FROM "public"."tasks" AS "tasks_2"');
        expect(sql).toContain('"tasks"."type" = $2');
        expect(runtime.executions[0]?.params).toEqual([
          { kind: 'literal', value: 'Has feature subtasks' },
          { kind: 'literal', value: 'feature' },
          { kind: 'literal', value: 'feature' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
