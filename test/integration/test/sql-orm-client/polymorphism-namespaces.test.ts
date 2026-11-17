import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgres from '@internal/postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/polymorphism-namespaces/generated/contract';
import contractJson from './fixtures/polymorphism-namespaces/generated/contract.json' with {
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
  return orm({ runtime, context }).a.Task;
}

const crash = { id: 1, title: 'Crash', type: 'bug', projectId: 1, severity: 'high' };
const search = { id: 2, title: 'Search', type: 'feature', projectId: 1, priority: 7 };
const dishes = { id: 3, title: 'Dishes', type: 'chore', projectId: null, effort: 5, ownerId: 1 };
const laundry = {
  id: 4,
  title: 'Laundry',
  type: 'chore',
  projectId: null,
  effort: 2,
  ownerId: null,
};
const roadmap = { id: 5, title: 'Roadmap', type: 'b-epic', projectId: 1, size: 8 };
const vision = { id: 6, title: 'Vision', type: 'c-epic', projectId: null, size: 'large' };

async function withTasks(
  fn: (
    runtime: PgIntegrationRuntime,
    tasks: ReturnType<typeof tasksOf>,
    connectionString: string,
  ) => Promise<void>,
): Promise<void> {
  await withPushedContractRuntime(contract, async (runtime, connectionString) => {
    await runtime.query(`insert into a.projects (id, name) values (1, 'Apollo')`);
    await runtime.query(`insert into b.owners (id, name) values (1, 'Ada')`);
    await runtime.query(`
      insert into a.tasks (id, title, type, project_id, severity) values
        (1, 'Crash', 'bug', 1, 'high'),
        (2, 'Search', 'feature', 1, null),
        (3, 'Dishes', 'chore', null, null),
        (4, 'Laundry', 'chore', null, null),
        (5, 'Roadmap', 'b-epic', 1, null),
        (6, 'Vision', 'c-epic', null, null)
    `);
    await runtime.query('insert into a.features (id, priority) values (2, 7)');
    await runtime.query(
      'insert into b.tasks (id, effort, owner_id) values (3, 5, 1), (4, 2, null)',
    );
    await runtime.query('insert into b.epics (id, size) values (5, 8)');
    await runtime.query(`insert into c.epics (id, size) values (6, 'large')`);
    runtime.resetExecutions();
    await fn(runtime, tasksOf(runtime), connectionString);
  });
}

describe('integration/polymorphism-namespaces', () => {
  it(
    'default projection: the base collection reads every variant from the table in its own namespace',
    async () => {
      await withTasks(async (runtime, tasks) => {
        const rows = await tasks.orderBy((task) => task.id.asc()).all();

        expect(rows).toEqual([crash, search, dishes, laundry, roadmap, vision]);
        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain(
          'LEFT JOIN "b"."tasks" AS "tasks_2" ON "tasks"."id" = "tasks_2"."id"',
        );
        expect(sql).toContain('"tasks_2"."effort" AS "tasks_2__effort"');
        expect(sql).toContain('"b"."epics" ON');
        expect(sql).toContain('"c"."epics" AS "epics_2"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: variant() reads each variant with its own fields',
    async () => {
      await withTasks(async (_runtime, tasks) => {
        expect({
          bug: await tasks.variant('bug').all(),
          feature: await tasks.variant('feature').all(),
          chore: await tasks
            .variant('chore')
            .orderBy((task) => task.id.asc())
            .all(),
          bEpic: await tasks.variant('b-epic').all(),
          cEpic: await tasks.variant('c-epic').all(),
        }).toEqual({
          bug: [crash],
          feature: [search],
          chore: [dishes, laundry],
          bEpic: [roadmap],
          cEpic: [vision],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: where() and orderBy() use a field and a relation of a variant in another namespace',
    async () => {
      await withTasks(async (_runtime, tasks) => {
        expect(
          await tasks
            .variant('chore')
            .where((task) => task.effort.gt(1))
            .orderBy((task) => task.effort.asc())
            .all(),
        ).toEqual([laundry, dishes]);
        expect(
          await tasks
            .variant('chore')
            .where((task) => task.owner.some())
            .all(),
        ).toEqual([dishes]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'select() reads a field two variants in other namespaces declare, each from its own table',
    async () => {
      await withTasks(async (_runtime, tasks) => {
        const untyped = tasks as unknown as { select(...fields: string[]): typeof tasks };
        expect(
          await untyped
            .select('id', 'size')
            .orderBy((task) => task.id.asc())
            .all(),
        ).toEqual([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 5, size: 8 },
          { id: 6, size: 'large' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: include() of the base reads variants in other namespaces',
    async () => {
      await withTasks(async (runtime) => {
        expect(
          await orm({ runtime, context })
            .a.Project.select('name')
            .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
            .all(),
        ).toEqual([{ name: 'Apollo', tasks: [crash, search, roadmap] }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: include() reads a relation a variant in another namespace declares',
    async () => {
      await withTasks(async (_runtime, tasks) => {
        expect(
          await tasks
            .variant('chore')
            .orderBy((task) => task.id.asc())
            .include('owner', (owner) => owner.select('name'))
            .all(),
        ).toEqual([
          { ...dishes, owner: { name: 'Ada' } },
          { ...laundry, owner: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'aggregate() reduces over rows filtered by a field of a variant in another namespace',
    async () => {
      await withTasks(async (_runtime, tasks) => {
        expect(
          await tasks
            .variant('chore')
            .where((task) => task.effort.gt(1))
            .aggregate((aggregate) => ({ count: aggregate.count(), ids: aggregate.sum('id') })),
        ).toEqual({ count: 2, ids: 7 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: a prepared query filters by a field of a variant in another namespace',
    async () => {
      await withTasks(async (_runtime, _tasks, connectionString) => {
        const client = new Client({ connectionString });
        await client.connect();
        const db = postgres({ contract, pg: client, verifyMarker: false });
        try {
          const runtime = await db.connect();
          const chores = await db.prepare({ effort: 'pg/int4@1' }, (params) =>
            db.orm.a.Task.variant('chore')
              .where((task) => task.effort.gt(params.effort))
              .orderBy((task) => task.id.asc())
              .prepared.all(),
          );
          expect(await chores.query(runtime, { effort: 1 })).toEqual([dishes, laundry]);
          expect(await chores.query(runtime, { effort: 3 })).toEqual([dishes]);
        } finally {
          await db.close();
          await client.end();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: create() and createAll() insert the variant row into the table in its own namespace',
    async () => {
      await withTasks(async (runtime, tasks) => {
        const ironing = {
          id: 7,
          title: 'Ironing',
          type: 'chore',
          projectId: null,
          effort: 1,
          ownerId: 1,
        };
        const launch = { id: 8, title: 'Launch', type: 'c-epic', projectId: 1, size: 'small' };
        const merger = { id: 9, title: 'Merger', type: 'c-epic', projectId: null, size: 'huge' };

        expect(
          await tasks.variant('chore').create({ id: 7, title: 'Ironing', effort: 1, ownerId: 1 }),
        ).toEqual(ironing);
        expect(
          await tasks.variant('c-epic').createAll([
            { id: 8, title: 'Launch', projectId: 1, size: 'small' },
            { id: 9, title: 'Merger', size: 'huge' },
          ]),
        ).toEqual([launch, merger]);

        expect(await runtime.query('select id, effort, owner_id from b.tasks order by id')).toEqual(
          [
            { id: 3, effort: 5, owner_id: 1 },
            { id: 4, effort: 2, owner_id: null },
            { id: 7, effort: 1, owner_id: 1 },
          ],
        );
        expect(await runtime.query('select id, size from c.epics order by id')).toEqual([
          { id: 6, size: 'large' },
          { id: 8, size: 'small' },
          { id: 9, size: 'huge' },
        ]);
        expect(await runtime.query('select id, size from b.epics order by id')).toEqual([
          { id: 5, size: 8 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'default projection: update() and delete() change one row of a variant in another namespace',
    async () => {
      await withTasks(async (runtime, tasks) => {
        await tasks.variant('chore').where({ id: 3 }).update({ title: 'Dishes again' });
        await tasks.variant('b-epic').where({ id: 5 }).delete();

        expect(await tasks.variant('chore').where({ id: 3 }).first()).toEqual({
          ...dishes,
          title: 'Dishes again',
        });

        expect(await runtime.query('select id, title from a.tasks order by id')).toEqual([
          { id: 1, title: 'Crash' },
          { id: 2, title: 'Search' },
          { id: 3, title: 'Dishes again' },
          { id: 4, title: 'Laundry' },
          { id: 6, title: 'Vision' },
        ]);
        expect(await runtime.query('select id from b.epics')).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAndCount() and deleteAndCount() filter by a field of a variant in another namespace',
    async () => {
      await withTasks(async (runtime, tasks) => {
        expect(
          await tasks
            .variant('chore')
            .where((task) => task.effort.gt(3))
            .updateAndCount({ title: 'Heavy' }),
        ).toBe(1);
        expect(
          await tasks
            .variant('chore')
            .where((task) => task.effort.lt(3))
            .deleteAndCount(),
        ).toBe(1);

        expect(await runtime.query('select id, title from a.tasks order by id')).toEqual([
          { id: 1, title: 'Crash' },
          { id: 2, title: 'Search' },
          { id: 3, title: 'Heavy' },
          { id: 5, title: 'Roadmap' },
          { id: 6, title: 'Vision' },
        ]);
        expect(await runtime.query('select id from b.tasks')).toEqual([{ id: 3 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'whereUnique() refuses the inherited key on a variant model whose base table has the same name in another namespace',
    async () => {
      await withTasks(async (runtime) => {
        const db = orm({ runtime, context });
        const incompleteKey = expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' });
        expect(() => db.a.Feature.whereUnique({ id: 2 })).toThrow(incompleteKey);
        expect(() => db.b.Chore.whereUnique({ id: 3 })).toThrow(incompleteKey);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
