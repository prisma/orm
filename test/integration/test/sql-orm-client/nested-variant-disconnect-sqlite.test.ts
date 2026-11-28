import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
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
model Task {
  id       Int       @id
  title    String
  type     String
  comments Comment[]

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String?

  @@base(Task, "bug")
}

model Feature {
  priority Int

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
`;

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
      sqliteTargetControl.contractSerializer.serializeContract(
        enrichContract(result.value, [
          sqliteTargetControl,
          sqliteControlAdapter,
        ]) as Contract<SqlStorage>,
      ),
    ) as Contract<SqlStorage>;
  return { contract, namespaceId: stack.target.defaultNamespaceId };
}

type Disconnect = (task: {
  variant(value: string): { disconnect(criteria?: readonly object[]): unknown };
}) => unknown;

describe('integration/nested variant disconnect on SQLite', () => {
  it(
    'unlinks the parent only when the linked row is of the variant and matches the criteria',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'pn-variant-disconnect-'));
      try {
        const { contract, namespaceId } = await authorContract(directory);
        const path = join(directory, 'test.db');
        const database = new DatabaseSync(path);
        database.exec(`
          create table tasks (id integer primary key, title text not null, type text not null, severity text);
          create table features (id integer primary key references tasks(id), priority integer not null);
          create table comments (id integer primary key, body text not null, task_id integer);
          insert into tasks values (1, 'Crash', 'bug', 'high'), (2, 'Dark mode', 'feature', null), (5, 'Freeze', 'bug', null);
          insert into features values (2, 1);
          insert into comments values (1, 'Seen it', 1);
        `);
        database.close();
        const stack = createSqlExecutionStack({
          target: sqliteTarget,
          adapter: sqliteAdapter,
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
          closeRefusal: undefined,
        });
        const comments = new Collection({ runtime, context }, 'Comment', { namespaceId }).select(
          'id' as never,
          'taskId' as never,
        );
        const disconnect = (task: Disconnect) =>
          comments.where({ id: 1 } as never).update({ task } as never);
        const relink = (taskId: number) => {
          const writer = new DatabaseSync(path);
          try {
            writer.prepare('update comments set task_id = ? where id = 1').run(taskId);
          } finally {
            writer.close();
          }
        };
        try {
          const otherVariant = await disconnect((task) => task.variant('feature').disconnect());
          const otherRow = await disconnect((task) => task.variant('bug').disconnect([{ id: 5 }]));
          const bug = await disconnect((task) =>
            task.variant('bug').disconnect([{ id: 5 }, { id: 1 }]),
          );
          relink(2);
          const otherFeature = await disconnect((task) => task.variant('bug').disconnect());
          const feature = await disconnect((task) => task.variant('feature').disconnect());

          expect([otherVariant, otherRow, bug, otherFeature, feature]).toEqual([
            { id: 1, taskId: 1 },
            { id: 1, taskId: 1 },
            { id: 1, taskId: null },
            { id: 1, taskId: 2 },
            { id: 1, taskId: null },
          ]);
        } finally {
          await runtime.close();
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    timeouts.databaseOperation,
  );
});
