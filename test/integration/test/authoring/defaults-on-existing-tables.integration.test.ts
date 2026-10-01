import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import sqlite from '@internal/target-sqlite/control';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  sqliteContractFromPsl,
  sqliteFrameworkComponents,
  sqliteStack,
} from '../date-time-defaults/sqlite-authoring';
import {
  authorSqlContractFromPsl,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const EVERY_CLASS = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

interface Stack {
  readonly family: ReturnType<typeof sql.create>;
  readonly planner: ReturnType<typeof postgres.createPlanner>;
  readonly runner: ReturnType<typeof postgres.createRunner>;
  readonly frameworkComponents:
    | typeof postgresFrameworkComponents
    | typeof sqliteFrameworkComponents;
}

type Driver = Parameters<ReturnType<typeof sql.create>['introspect']>[0]['driver'];

const postgresStack = (() => {
  const controlStack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresControlDriver,
    extensions: [],
  });
  const family = sql.create(controlStack);
  return {
    family,
    planner: postgres.createPlanner(postgresAdapter.create(controlStack)),
    runner: postgres.createRunner(family),
    frameworkComponents: postgresFrameworkComponents,
  };
})();

const sqliteControl = (() => {
  const family = sql.create(sqliteStack);
  return {
    family,
    planner: sqlite.createPlanner(sqliteAdapter.create(sqliteStack)),
    runner: sqlite.createRunner(family),
    frameworkComponents: sqliteFrameworkComponents,
  };
})();

/** Plans the move from what the database holds to `contract` and applies it, returning the planned operation ids. */
async function move(
  stack: Stack,
  driver: Driver,
  contract: Contract<SqlStorage>,
  fromContract: Contract<SqlStorage> | null,
) {
  const planned = stack.planner.plan({
    contract,
    schema: await stack.family.introspect({ driver }),
    policy: fromContract === null ? INIT_ADDITIVE_POLICY : EVERY_CLASS,
    fromContract,
    frameworkComponents: stack.frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planned.kind !== 'success') throw new Error(`planner failed: ${JSON.stringify(planned)}`);
  const operations = await Promise.all(planned.plan.operations);
  const applied = await stack.runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: APP_SPACE_ID,
        plan: planned.plan,
        migrationEdges: [
          buildFabricatedMigrationEdge({
            currentMarkerStorageHash: planned.plan.origin?.storageHash,
            destinationStorageHash: planned.plan.destination.storageHash,
            operationCount: operations.length,
          }),
        ],
        driver,
        destinationContract: contract,
        policy: fromContract === null ? INIT_ADDITIVE_POLICY : EVERY_CLASS,
        frameworkComponents: stack.frameworkComponents,
      },
    ],
  });
  if (!applied.ok) {
    throw new Error(
      `runner failed after ${JSON.stringify(operations.map((operation) => [operation.id, operation.execute.map((step) => step.sql)]))}: ${JSON.stringify(applied.failure)}`,
    );
  }
  return operations.map((operation) => operation.id);
}

/** Applies `before`, moves the database to `after`, then verifies it and plans again. */
async function moveAndVerify(
  stack: Stack,
  driver: Driver,
  before: Contract<SqlStorage>,
  after: Contract<SqlStorage>,
) {
  await move(stack, driver, before, null);
  const planned = await move(stack, driver, after, before);
  const introspected = await stack.family.introspect({ driver, contract: after });
  const verified = stack.family.verifySchema({
    contract: after,
    schema: introspected,
    strict: false,
    frameworkComponents: stack.frameworkComponents,
  });
  const replanned = stack.planner.plan({
    contract: after,
    schema: introspected,
    policy: EVERY_CLASS,
    fromContract: after,
    frameworkComponents: stack.frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  return {
    planned: [...planned].sort(),
    issues: verified.schema.issues,
    replanned:
      replanned.kind === 'success'
        ? (await Promise.all(replanned.plan.operations)).map((operation) => operation.id)
        : replanned,
  };
}

async function postgresContract(schema: string): Promise<Contract<SqlStorage>> {
  const authored = await authorSqlContractFromPsl(schema);
  if (authored.contract === undefined) throw new Error(JSON.stringify(authored.diagnostics));
  return authored.contract;
}

const POSTGRES_BEFORE = `
model Box {
  id       Int            @id
  tags     String[]       @default(["x"])
  at       DateTime       @default("2020-01-01T00:00:00Z")
  hundreds Numeric(5, -2) @default(100)
  code     Char(5)        @default("z")
  token    Uuid           @default("11111111-1111-1111-1111-111111111111")
}
`;

const POSTGRES_AFTER = `
model Box {
  id          Int            @id
  tags        String[]       @default(["a", "b"])
  at          DateTime       @default("2024-01-01T01:00:00+01:00")
  hundreds    Numeric(5, -2) @default(12300)
  code        Char(5)        @default("ab")
  token       Uuid           @default("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")
  addedTags   String[]       @default(["a", "b"])
  addedEmpty  String[]       @default([])
  addedAt     Timestamp      @default("0044-03-15 12:00:00 BC")
  addedNumber Numeric(5, -2) @default(-9999900)
  addedCode   Char(5)        @default("ab")
  addedToken  Uuid           @default("{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}")
}
`;

describe('a default the codecs read, on a table the database already has', () => {
  it(
    'on Postgres, a new column and a changed default apply, verify and plan no change',
    async () => {
      const database = await createDevDatabase();
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const result = await moveAndVerify(
          postgresStack,
          driver,
          await postgresContract(POSTGRES_BEFORE),
          await postgresContract(POSTGRES_AFTER),
        );
        expect(result).toEqual({
          planned: [
            'setDefault.Box.tags',
            'setDefault.Box.at',
            'setDefault.Box.hundreds',
            'setDefault.Box.code',
            'setDefault.Box.token',
            'column.public.Box.addedTags',
            'column.public.Box.addedEmpty',
            'column.public.Box.addedAt',
            'column.public.Box.addedNumber',
            'column.public.Box.addedCode',
            'column.public.Box.addedToken',
            'checkConstraint.Box.Box_addedEmpty_elem_not_null_41fe3204',
            'checkConstraint.Box.Box_addedTags_elem_not_null_39513bef',
          ].sort(),
          issues: [],
          replanned: [],
        });
      } finally {
        await driver.close();
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it.each([
    [
      'a new column',
      'model Note {\n  id Int @id\n}\n',
      `model Note {
  id    Int      @id
  body  String   @default("ab")
  at    DateTime @default("2024-01-01T01:00:00+01:00")
  data  Json     @default(json\`{"a": [1, "x"]}\`)
  big   BigInt   @default(9007199254740993)
  ratio Float    @default(1.5)
}
`,
      [
        'column.Note.at',
        'column.Note.big',
        'column.Note.body',
        'column.Note.data',
        'column.Note.ratio',
      ],
    ],
    [
      'a changed default, which rebuilds the table',
      `model Note {
  id    Int      @id
  body  String   @default("z")
  at    DateTime @default("2020-01-01T00:00:00Z")
  data  Json     @default(json\`{"a": 0}\`)
  big   BigInt   @default(1)
  ratio Float    @default(2.5)
}
`,
      `model Note {
  id    Int      @id
  body  String   @default("ab")
  at    DateTime @default("2024-01-01T01:00:00+01:00")
  data  Json     @default(json\`{"a": [1, "x"]}\`)
  big   BigInt   @default(9007199254740993)
  ratio Float    @default(1.5)
}
`,
      ['recreateTable.Note'],
    ],
  ])(
    'on SQLite, %s applies, verifies and plans no change',
    async (_name, before, after, planned) => {
      const directory = mkdtempSync(join(tmpdir(), 'pn-defaults-existing-'));
      const driver = await sqliteDriver.create(join(directory, 'test.db'));
      try {
        const result = await moveAndVerify(
          sqliteControl,
          driver,
          await sqliteContractFromPsl(before),
          await sqliteContractFromPsl(after),
        );
        expect(result).toEqual({ planned, issues: [], replanned: [] });
      } finally {
        await driver.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
    timeouts.databaseOperation,
  );
});
