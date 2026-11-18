import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildBoundContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import {
  ColumnRef,
  IdentifierRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import type { PostgresContract } from '../../src/core/types';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
} from './fixtures/runner-fixtures';

const postgresTypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};

const pgText = { codecId: 'pg/text@1' as const };

// Declaration order: low → high → medium. Lexical order would be high, low, medium.
const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Medium', 'medium'),
);

function makeTaskContract(): PostgresContract {
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Priority }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        Task: m('Task', {
          fields: {
            id: f.column(type.String()).id(),
            priority: f.namedType(Priority).optional(),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage> as PostgresContract;
}

async function migrate(driver: PostgresControlDriver, contract: PostgresContract): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`Planner failed: ${JSON.stringify(result, null, 2)}`);
  }
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: result.plan.spaceId ?? APP_SPACE_ID,
        plan: result.plan,
        migrationEdges: synthEdges(result.plan),
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

describe('ORDER BY on an enum column — value order, PGlite', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it('leaves a qualified enum column unchanged and sorts by value', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    // Insert rows out of declaration order.
    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(ColumnRef.of('Task', 'priority')),
        OrderByItem.asc(ColumnRef.of('Task', 'id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain('ORDER BY "Task"."priority" ASC, "Task"."id" ASC');

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['high', 'low', 'low', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('leaves an unqualified enum order column unchanged (sql-builder .orderBy form)', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain('ORDER BY "priority" ASC, "id" ASC');

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['high', 'low', 'low', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('sorts NULLs last (ASC) alongside value-ordered non-null values', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', NULL), ('c', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const rows = await driver!.query<{ id: string; priority: string | null }>(lowered.sql);

    expect(rows.rows.map((r) => r.priority)).toEqual(['high', 'low', null]);
    expect(rows.rows.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('distinctOn on a value-set column stays unchanged, matching orderBy', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withDistinctOn([IdentifierRef.of('priority')])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain('DISTINCT ON ("priority")');
    expect(lowered.sql).toContain('ORDER BY "priority" ASC, "id" ASC');
  });

  it('distinctOn on a value-set column executes without error', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'high')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withDistinctOn([IdentifierRef.of('priority')])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['high', 'low']);
  });
});
