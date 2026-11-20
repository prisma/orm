import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteAdapterCapabilities } from '@internal/adapter-sqlite/adapter';
import sqliteControlAdapter from '@internal/adapter-sqlite/control';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { enrichContract } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { Collection } from '@internal/sql-orm-client';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlMiddleware,
} from '@internal/sql-runtime';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTargetControl from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const schema = `// use prisma-8
model Person {
  id        Int      @id
  name      String
  managerId Int?     @map("manager_id")
  manager   Person?  @relation("Management", fields: [managerId], references: [id], onDelete: SetNull)
  reports   Person[] @relation("Management")
  notes     Note[]

  @@map("people")
}

model Note {
  id       Int    @id
  body     String
  personId Int    @map("person_id")
  person   Person @relation(fields: [personId], references: [id])

  @@map("notes")
}

model Task {
  id       Int       @id
  title    String
  type     String
  comments Comment[]

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority   Int
  assigneeId Int? @map("assignee_id")

  @@base(Task, "feature")
  @@map("features")
}

model Comment {
  id     Int    @id
  body   String
  taskId Int?   @map("task_id")
  task   Task?  @relation(fields: [taskId], references: [id])

  @@map("comments")
}

model Account {
  id        Int       @id
  addressId Int?      @map("address_id")
  address   Address?  @relation("Primary", fields: [addressId], references: [id], onDelete: SetNull)
  addresses Address[] @relation("Owned")

  @@map("accounts")
}

model Address {
  id        Int       @id
  accountId Int       @map("account_id")
  account   Account   @relation("Owned", fields: [accountId], references: [id])
  primaryOf Account[] @relation("Primary")

  @@map("addresses")
}
`;

const tables = `
  create table people (id integer primary key, name text not null, manager_id integer references people(id) on delete set null);
  create table notes (id integer primary key, body text not null, person_id integer not null references people(id));
  create table tasks (id integer primary key, title text not null, type text not null);
  create table features (id integer primary key references tasks(id), priority integer not null, assignee_id integer);
  create table comments (id integer primary key, body text not null, task_id integer references tasks(id));
  create table accounts (id integer primary key, address_id integer references addresses(id) on delete set null);
  create table addresses (id integer primary key, account_id integer not null references accounts(id));
`;

type IncludeStrategy = 'join' | 'query';
interface Mutator {
  where(filter: object): Mutator;
  create(data: object): unknown;
  connect(criterion: object): unknown;
  disconnect(criteria?: readonly object[]): unknown;
  update(data: object): unknown;
  delete(): unknown;
}

type Returning = 'with returning' | 'without returning';

async function authorContract(directory: string) {
  const stack = createControlStack({
    family: sql,
    target: sqliteTargetControl,
    adapter: sqliteControlAdapter,
  });
  const schemaPath = join(directory, 'schema.prisma');
  writeFileSync(schemaPath, schema, 'utf-8');
  const result = await prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
    composedExtensions: [],
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const contract = sql
    .create(stack)
    .deserializeContract(
      enrichContract(result.value, [sqliteTargetControl, sqliteControlAdapter]),
    ) as Contract<SqlStorage>;
  return { contract, namespaceId: stack.target.defaultNamespaceId };
}

function adapterFor(strategy: IncludeStrategy, returning: Returning): typeof sqliteAdapter {
  const oneQuery = strategy === 'join';
  return {
    ...sqliteAdapter,
    capabilities: {
      sql: {
        ...sqliteAdapterCapabilities.sql,
        outerReferencesInDerivedTables: oneQuery,
        jsonAggWithoutTruncation: oneQuery,
        returning: returning === 'with returning',
      },
    },
  };
}

interface Harness {
  readonly people: Collection<Contract<SqlStorage>, string>;
  readonly tasks: Collection<Contract<SqlStorage>, string>;
  readonly accounts: Collection<Contract<SqlStorage>, string>;
  readonly rows: (query: string) => unknown[];
  readonly statements: string[];
}

async function withDatabase(
  seed: string,
  fn: (harness: Harness) => Promise<void>,
  strategy: IncludeStrategy = 'join',
  returning: Returning = 'with returning',
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'pn-read-back-'));
  try {
    const { contract, namespaceId } = await authorContract(directory);
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(tables);
    database.exec(seed);
    database.close();
    const statements: string[] = [];
    const record = async (plan: { readonly sql: string }) => {
      statements.push(plan.sql);
      return undefined;
    };
    const recorder: SqlMiddleware = {
      name: 'statement-recorder',
      intercept: { onQuery: record, onExecute: record },
    };
    const stack = createSqlExecutionStack({
      target: sqliteTarget,
      adapter: adapterFor(strategy, returning),
      driver: sqliteDriver,
    });
    const context = createExecutionContext({ contract, stack });
    const { adapter, driver } = instantiateExecutionStack(stack);
    if (adapter === undefined || driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await driver.connect({ kind: 'path', path });
    const runtime = new SqliteRuntimeImpl({
      context,
      adapter,
      driver,
      middleware: [recorder],
      closeRefusal: undefined,
    });
    const rows = (query: string) => {
      const reader = new DatabaseSync(path);
      try {
        return reader
          .prepare(query)
          .all()
          .map((row) => ({ ...row }));
      } finally {
        reader.close();
      }
    };
    try {
      await fn({
        people: new Collection({ runtime, context }, 'Person', { namespaceId }),
        tasks: new Collection({ runtime, context }, 'Task', { namespaceId }),
        accounts: new Collection({ runtime, context }, 'Account', { namespaceId }),
        rows,
        statements,
      });
    } finally {
      await runtime.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function statementsOf(statements: readonly string[]): string[] {
  return statements.map((statement) => {
    const verb = statement.split(' ')[0] ?? '';
    const table = /"(people|notes|tasks|features|comments)"/.exec(statement)?.[1] ?? '';
    return `${verb} ${table}`;
  });
}

const peopleRows = 'select id, name, manager_id from people order by id';

describe('integration/an update() that sets none of the record fields returns the record as the database holds it, on SQLite', () => {
  it(
    'returns the record connected to itself',
    async () => {
      await withDatabase(
        `insert into people (id, name, manager_id) values (1, 'Ada', null)`,
        async ({ people, rows }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.connect({ id: 1 }) } as never);

          expect(updated).toEqual({ id: 1, managerId: 1 });
          expect(rows(peopleRows)).toEqual([{ id: 1, name: 'Ada', manager_id: 1 }]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the record updated through its own relation',
    async () => {
      await withDatabase(
        `insert into people (id, name, manager_id) values (1, 'Ada', 1)`,
        async ({ people, rows }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'name')
            .update({
              reports: (reports: Mutator) => reports.where({ id: 1 }).update({ name: 'Renamed' }),
            } as never);

          expect(updated).toEqual({ id: 1, name: 'Renamed' });
          expect(rows(peopleRows)).toEqual([{ id: 1, name: 'Renamed', manager_id: 1 }]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the record disconnected from itself',
    async () => {
      await withDatabase(
        `insert into people (id, name, manager_id) values (1, 'Ada', 1)`,
        async ({ people, rows }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.disconnect([{ id: 1 }]) } as never);

          expect(updated).toEqual({ id: 1, managerId: null });
          expect(rows(peopleRows)).toEqual([{ id: 1, name: 'Ada', manager_id: null }]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the record a declared foreign-key action changed',
    async () => {
      await withDatabase(
        `insert into people (id, name, manager_id) values (1, 'Ada', null), (2, 'Bea', 1);
         update people set manager_id = 2 where id = 1;`,
        async ({ people, rows }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ reports: (reports: Mutator) => reports.where({ id: 2 }).delete() } as never);

          expect(updated).toEqual({ id: 1, managerId: null });
          expect(rows(peopleRows)).toEqual([{ id: 1, name: 'Ada', manager_id: null }]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the record a declared foreign-key action changed after a delete in another table',
    async () => {
      await withDatabase(
        `insert into accounts (id, address_id) values (1, null);
         insert into addresses (id, account_id) values (2, 1);
         update accounts set address_id = 2 where id = 1;`,
        async ({ accounts, rows }) => {
          const updated = await accounts
            .where({ id: 1 })
            .select('id', 'addressId')
            .update({
              addresses: (addresses: Mutator) => addresses.where({ id: 2 }).delete(),
            } as never);

          expect(updated).toEqual({ id: 1, addressId: null });
          expect(rows('select id, address_id from accounts')).toEqual([
            { id: 1, address_id: null },
          ]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the fields of a variant stored in its own table',
    async () => {
      await withDatabase(
        `insert into tasks (id, title, type) values (1, 'Dark mode', 'feature');
         insert into features (id, priority, assignee_id) values (1, 3, 7);`,
        async ({ tasks, rows }) => {
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
          expect(rows('select id, body, task_id from comments')).toEqual([
            { id: 10, body: 'Seen it', task_id: 1 },
          ]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'returns the record after an N:1 delete of the row it holds the key of',
    async () => {
      await withDatabase(
        `insert into people (id, name, manager_id) values (2, 'Bea', null), (1, 'Ada', 2)`,
        async ({ people, rows }) => {
          const updated = await people
            .where({ id: 1 })
            .select('id', 'managerId')
            .update({ manager: (manager: Mutator) => manager.delete() } as never);

          expect(updated).toEqual({ id: 1, managerId: null });
          expect(rows(peopleRows)).toEqual([{ id: 1, name: 'Ada', manager_id: null }]);
        },
      );
    },
    timeouts.databaseOperation,
  );
});

describe.each(['join', 'query'] as const)(
  'integration/an update() that sets none of the record fields, with includes, on SQLite (%s)',
  (strategy) => {
    it(
      'returns the record with the included rows the nested write added',
      async () => {
        await withDatabase(
          `insert into people (id, name, manager_id) values (1, 'Ada', null)`,
          async ({ people }) => {
            const updated = await people
              .where({ id: 1 })
              .select('id', 'name')
              .include(
                'notes' as never,
                ((notes: Collection<Contract<SqlStorage>, string>) =>
                  notes.select('id', 'body')) as never,
              )
              .update({
                notes: (notes: Mutator) => notes.create({ id: 10, body: 'First' }),
              } as never);

            expect(updated).toEqual({ id: 1, name: 'Ada', notes: [{ id: 10, body: 'First' }] });
          },
          strategy,
        );
      },
      timeouts.databaseOperation,
    );
  },
);

describe.each(['with returning', 'without returning'] as const)(
  'integration/an update() that sets none of the record fields and writes no row of its table, on SQLite (%s)',
  (returning) => {
    it(
      'reads the record with one SELECT',
      async () => {
        await withDatabase(
          `insert into people (id, name, manager_id) values (1, 'Ada', null)`,
          async ({ people, statements }) => {
            const updated = await people
              .where({ id: 1 })
              .select('id', 'name')
              .update({
                notes: (notes: Mutator) => notes.create({ id: 10, body: 'First' }),
              } as never);

            expect(updated).toEqual({ id: 1, name: 'Ada' });
            expect(statementsOf(statements)).toEqual(['SELECT people', 'INSERT notes']);
          },
          'join',
          returning,
        );
      },
      timeouts.databaseOperation,
    );
  },
);
