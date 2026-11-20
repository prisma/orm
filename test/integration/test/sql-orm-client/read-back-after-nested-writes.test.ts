import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl } from '../scalar-lists/psl-list-authoring';
import { postgresAdapterFor } from './helpers';
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const schema = `
model Person {
  id        Int      @id
  name      String
  managerId Int?     @map("manager_id")
  manager   Person?  @relation("Management", fields: [managerId], references: [id], onDelete: SetNull)
  reports   Person[] @relation("Management")
  notes     Note[]

  @@map("rb_people")
}

model Note {
  id       Int    @id
  body     String
  personId Int    @map("person_id")
  person   Person @relation(fields: [personId], references: [id])

  @@map("rb_notes")
}

model Task {
  id       Int       @id
  title    String
  type     String
  comments Comment[]

  @@discriminator(type)
  @@map("rb_tasks")
}

model Feature {
  priority   Int
  assigneeId Int? @map("assignee_id")

  @@base(Task, "feature")
  @@map("rb_features")
}

model Comment {
  id     Int    @id
  body   String
  taskId Int?   @map("task_id")
  task   Task?  @relation(fields: [taskId], references: [id])

  @@map("rb_comments")
}

model Account {
  id        Int       @id
  addressId Int?      @map("address_id")
  address   Address?  @relation("Primary", fields: [addressId], references: [id], onDelete: SetNull)
  addresses Address[] @relation("Owned")

  @@map("rb_accounts")
}

model Address {
  id        Int       @id
  accountId Int       @map("account_id")
  account   Account   @relation("Owned", fields: [accountId], references: [id])
  primaryOf Account[] @relation("Primary")

  @@map("rb_addresses")
}
`;

interface Mutator {
  where(filter: object): Mutator;
  create(data: object): unknown;
  connect(criterion: object): unknown;
  disconnect(criteria?: readonly object[]): unknown;
  update(data: object): unknown;
  delete(): unknown;
}

type Returning = 'with returning' | 'without returning';

const withoutReturning = {
  ...postgresAdapterCapabilities,
  postgres: { ...postgresAdapterCapabilities.postgres, returning: false },
  sql: { ...postgresAdapterCapabilities.sql, returning: false },
};

interface Collections {
  readonly runtime: PgIntegrationRuntime;
  readonly people: Collection<Contract<SqlStorage>, string>;
  readonly tasks: Collection<Contract<SqlStorage>, string>;
  readonly accounts: Collection<Contract<SqlStorage>, string>;
}

async function withDatabase(
  seed: string,
  fn: (collections: Collections) => Promise<void>,
  returning: Returning = 'with returning',
): Promise<void> {
  const authored = await authorSqlContractFromPsl(schema);
  expect(authored.diagnostics).toEqual([]);
  const contract = authored.contract!;
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter:
        returning === 'with returning'
          ? postgresAdapterFor('join')
          : postgresAdapterFor('join', withoutReturning),
    }),
  });
  await withPushedContractRuntime(contract, async (runtime) => {
    await runtime.query(seed);
    runtime.resetExecutions();
    await fn({
      runtime,
      people: new Collection({ runtime, context }, 'Person', { namespaceId: 'public' }),
      tasks: new Collection({ runtime, context }, 'Task', { namespaceId: 'public' }),
      accounts: new Collection({ runtime, context }, 'Account', { namespaceId: 'public' }),
    });
  });
}

async function peopleRows(runtime: PgIntegrationRuntime) {
  return runtime.query('select id, name, manager_id from rb_people order by id');
}

function statementsOf(runtime: PgIntegrationRuntime): string[] {
  return runtime.executions.map(({ sql }) => {
    const verb = sql.split(' ')[0] ?? '';
    const table = /"(rb_[a-z_]+)"/.exec(sql)?.[1] ?? '';
    return `${verb} ${table}`;
  });
}

describe('integration/an update() that sets none of the record fields returns the record as the database holds it', () => {
  it(
    'returns the record connected to itself',
    async () => {
      await withDatabase(
        `insert into rb_people (id, name, manager_id) values (1, 'Ada', null)`,
        async ({ runtime, people }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.connect({ id: 1 }) } as never);

          expect(updated).toEqual({ id: 1, managerId: 1 });
          expect(await peopleRows(runtime)).toEqual([{ id: 1, name: 'Ada', manager_id: 1 }]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns the record updated through its own relation',
    async () => {
      await withDatabase(
        `insert into rb_people (id, name, manager_id) values (1, 'Ada', 1)`,
        async ({ runtime, people }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'name')
            .update({
              reports: (reports: Mutator) => reports.where({ id: 1 }).update({ name: 'Renamed' }),
            } as never);

          expect(updated).toEqual({ id: 1, name: 'Renamed' });
          expect(await peopleRows(runtime)).toEqual([{ id: 1, name: 'Renamed', manager_id: 1 }]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns the record disconnected from itself',
    async () => {
      await withDatabase(
        `insert into rb_people (id, name, manager_id) values (1, 'Ada', 1)`,
        async ({ runtime, people }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.disconnect([{ id: 1 }]) } as never);

          expect(updated).toEqual({ id: 1, managerId: null });
          expect(await peopleRows(runtime)).toEqual([{ id: 1, name: 'Ada', manager_id: null }]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns the record a declared foreign-key action changed',
    async () => {
      await withDatabase(
        `insert into rb_people (id, name, manager_id) values (1, 'Ada', null), (2, 'Bea', 1);
         update rb_people set manager_id = 2 where id = 1`,
        async ({ runtime, people }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.where({ id: 2 }).delete() } as never);

          expect(updated).toEqual({ id: 1, managerId: null });
          expect(await peopleRows(runtime)).toEqual([{ id: 1, name: 'Ada', manager_id: null }]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns the record a declared foreign-key action changed after a delete in another table',
    async () => {
      await withDatabase(
        `insert into rb_accounts (id, address_id) values (1, null);
         insert into rb_addresses (id, account_id) values (2, 1);
         update rb_accounts set address_id = 2 where id = 1;`,
        async ({ runtime, accounts }) => {
          const updated = await accounts
            .where({ id: 1 })
            .select('id', 'addressId')
            .update({
              addresses: (addresses: Mutator) => addresses.where({ id: 2 }).delete(),
            } as never);

          expect(updated).toEqual({ id: 1, addressId: null });
          expect(await runtime.query('select id, address_id from rb_accounts')).toEqual([
            { id: 1, address_id: null },
          ]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns the fields of a variant stored in its own table',
    async () => {
      await withDatabase(
        `insert into rb_tasks (id, title, type) values (1, 'Dark mode', 'feature');
         insert into rb_features (id, priority, assignee_id) values (1, 3, 7)`,
        async ({ runtime, tasks }) => {
          const updated = await tasks.where({ id: 1 }).update({
            comments: (comments: Mutator) => comments.create({ id: 10, body: 'Seen it' }),
          } as never);

          const feature = {
            id: 1,
            title: 'Dark mode',
            type: 'feature',
            priority: 3,
            assigneeId: 7,
          };
          expect(updated).toEqual(feature);
          expect(await tasks.where({ id: 1 }).first()).toEqual(feature);
          expect(await runtime.query('select id, body, task_id from rb_comments')).toEqual([
            { id: 10, body: 'Seen it', task_id: 1 },
          ]);
        },
      );
    },
    timeouts.spinUpPpgDev,
  );
});

describe.each(['with returning', 'without returning'] as const)(
  'integration/an update() that sets none of the record fields and writes no row of its table (%s)',
  (returning) => {
    it(
      'reads the record with one SELECT',
      async () => {
        await withDatabase(
          `insert into rb_people (id, name, manager_id) values (1, 'Ada', null)`,
          async ({ runtime, people }) => {
            const updated = await people
              .where({ id: 1 })
              .select('id', 'name')
              .update({
                notes: (notes: Mutator) => notes.create({ id: 10, body: 'First' }),
              } as never);

            expect(updated).toEqual({ id: 1, name: 'Ada' });
            expect(statementsOf(runtime)).toEqual(['SELECT rb_people', 'INSERT rb_notes']);
          },
          returning,
        );
      },
      timeouts.spinUpPpgDev,
    );
  },
);
