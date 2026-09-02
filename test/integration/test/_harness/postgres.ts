import postgresAdapterControl from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriverControl from '@internal/driver-postgres/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import postgres from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll } from 'vitest';

/**
 * Generic Postgres harness for ported tests.
 *
 * Each ported suite authors its schema as PSL (`_fixtures/<suite>/contract.prisma`)
 * and emits a `contract.json`/`contract.d.ts`. The harness:
 *   1. reuses one PGlite dev database server for each contract used by the test file and clears rows per test,
 *   2. **pushes the contract to the database** through prisma-next's own
 *      plan → apply path (the same mechanism `prisma db init` uses) — no
 *      hand-written DDL, so the materialised schema can never drift from the
 *      contract under test,
 *   3. opens the public **`postgres(...)` facade** over the same database and
 *      yields its `orm` handle for the query-under-test plus the facade's
 *      `transaction(cb)` for interactive transactions — i.e. ports run through
 *      the same high-level API a user writes, not a bespoke low-level stack.
 *
 * `returning` capability is enabled by default so `create/update/delete` read
 * rows back, matching Prisma Client behaviour. `verifyMarker: false` skips the
 * facade's marker-verification round-trip, which would otherwise acquire its own
 * connection and deadlock against PGlite's single-connection limit inside a
 * `transaction(...)`.
 */

const serializer = new PostgresContractSerializer();

const databases = new Map<string, DevDatabase>();

afterAll(async () => {
  for (const database of databases.values()) {
    await database.close();
  }
  databases.clear();
}, timeouts.spinUpPpgDev);

const controlStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  driver: postgresDriverControl,
  extensions: [],
});
const controlFamily = sqlFamilyControl.create(controlStack);
const controlAdapter = postgresAdapterControl.create(controlStack);
const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
] as const;

type PortClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof postgres<TContract>>;

export interface PortContext<TContract extends Contract<SqlStorage>> {
  /** Full Postgres facade for SQL builder and runtime access. */
  readonly client: PortClient<TContract>;
  /** ORM handle: `db.<namespace>.<Model>...` (the facade's `orm`). */
  readonly db: PortClient<TContract>['orm'];
  /** Interactive transaction: `transaction(async (tx) => { tx.orm.<ns>.<Model>... })`. */
  readonly transaction: PortClient<TContract>['transaction'];
  readonly contract: TContract;
}

export interface WithPostgresPortOptions {
  /** The emitted `contract.json` (imported with `{ type: 'json' }`). */
  readonly contractJson: unknown;
  /** Enable the `returning` capability (default true). */
  readonly returning?: boolean;
  /** Replace the database server after this test (default false). */
  readonly replaceDatabase?: boolean;
}

function enableReturning<T extends Contract<SqlStorage>>(contract: T): T {
  return {
    ...contract,
    capabilities: { ...contract.capabilities, returning: { enabled: true } },
  } as T;
}

async function clearRows(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    const tables = await client.query<{ schemaName: string; tableName: string }>(`
      select schemaname as "schemaName", tablename as "tableName"
      from pg_tables
      where schemaname not like 'pg_%'
        and schemaname !~ '^_prisma_dev_'
        and schemaname not in ('information_schema', 'prisma_contract')
    `);
    if (tables.rows.length === 0) {
      return;
    }
    const names = tables.rows.map(
      ({ schemaName, tableName }) =>
        `${client.escapeIdentifier(schemaName)}.${client.escapeIdentifier(tableName)}`,
    );
    await client.query(`truncate table ${names.join(', ')} restart identity cascade`);
  });
}

/** Pushes `contract` into a clean database via plan → apply (greenfield init). */
async function pushContract(connectionString: string, contractJson: unknown): Promise<void> {
  const contract = controlFamily.deserializeContract(contractJson) as Contract<SqlStorage>;
  const driver = await postgresDriverControl.create(connectionString);
  try {
    const schema = await controlFamily.introspect({ driver, contract });
    const planner = postgresTargetControl.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      // Execute-only push (no TypeScript scaffold rendered), so this is cosmetic;
      // kept to match the canonical planner call shape.
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planResult)}`);
    }
    const plan = planResult.plan;
    const runner = postgresTargetControl.createRunner(controlFamily);
    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(executeResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

export async function withPostgresPort<TContract extends Contract<SqlStorage>>(
  options: WithPostgresPortOptions,
  fn: (ctx: PortContext<TContract>) => Promise<void>,
): Promise<void> {
  const base = serializer.deserializeContract(
    JSON.parse(JSON.stringify(options.contractJson)),
  ) as TContract;
  const contract = options.returning === false ? base : enableReturning(base);

  const storageHash = base.storage.storageHash;
  let database = databases.get(storageHash);
  if (database === undefined) {
    database = await createDevDatabase({ databaseIdleTimeoutMillis: 30_000 });
    try {
      await pushContract(database.connectionString, options.contractJson);
    } catch (error) {
      await database.close();
      throw error;
    }
    databases.set(storageHash, database);
  } else {
    await clearRows(database.connectionString);
  }

  const client = postgres<TContract>({
    contract,
    url: database.connectionString,
    verifyMarker: false,
  });
  const runtime = await client.connect();
  try {
    await fn({
      client,
      db: client.orm,
      transaction: client.transaction.bind(client),
      contract,
    });
  } finally {
    await runtime.close();
    if (options.replaceDatabase === true) {
      databases.delete(storageHash);
      await database.close();
    }
  }
}

export { timeouts };
