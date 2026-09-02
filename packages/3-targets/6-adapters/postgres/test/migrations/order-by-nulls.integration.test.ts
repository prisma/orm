import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import {
  ColumnRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
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

function makeProbeContract(): PostgresContract {
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { createNamespace: postgresCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        Probe: m('Probe', {
          fields: {
            id: f.text().id(),
            nullable: f.text().optional(),
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

function probeOrderedBy(nulls: 'first' | 'last' | undefined, dir: 'asc' | 'desc'): SelectAst {
  return SelectAst.from(TableSource.named('Probe', undefined, 'public'))
    .withProjection([ProjectionItem.of('nullable', ColumnRef.of('Probe', 'nullable'))])
    .withOrderBy([new OrderByItem(ColumnRef.of('Probe', 'nullable'), dir, nulls)]);
}

describe('ORDER BY NULLS placement — PGlite', { concurrent: false }, () => {
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
    await migrate(driver, makeProbeContract());
    await driver.query(`INSERT INTO "Probe" (id, nullable) VALUES
      ('1', 'b'), ('2', NULL), ('3', 'a'), ('4', NULL), ('5', 'c')`);
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, timeouts.spinUpPpgDev);

  async function orderedValues(ast: SelectAst): Promise<Array<string | null>> {
    const contract = makeProbeContract();
    const lowered = createPostgresAdapter().lower(ast, { contract });
    const result = await driver!.query<{ nullable: string | null }>(lowered.sql);
    return result.rows.map((row) => row.nullable);
  }

  it('sorts NULLs last on a descending order, overriding the PostgreSQL default', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    expect(await orderedValues(probeOrderedBy('last', 'desc'))).toEqual([
      'c',
      'b',
      'a',
      null,
      null,
    ]);
  });

  it('sorts NULLs first on an ascending order, overriding the PostgreSQL default', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    expect(await orderedValues(probeOrderedBy('first', 'asc'))).toEqual([
      null,
      null,
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps the PostgreSQL default placement when no nulls option is given', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    // PostgreSQL ranks NULLs highest: last under ASC, first under DESC.
    expect(await orderedValues(probeOrderedBy(undefined, 'asc'))).toEqual([
      'a',
      'b',
      'c',
      null,
      null,
    ]);
    expect(await orderedValues(probeOrderedBy(undefined, 'desc'))).toEqual([
      null,
      null,
      'c',
      'b',
      'a',
    ]);
  });
});
