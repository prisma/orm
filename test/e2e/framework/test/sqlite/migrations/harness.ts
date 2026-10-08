import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import sqliteAdapterDescriptor, {
  createSqliteBuiltinCodecLookup,
  SqliteControlAdapter,
} from '@prisma/orm-sqlite/adapter/control';
import {
  APP_SPACE_ID,
  createControlStack,
  issueOutcome,
  type MigrationOperationPolicy,
  type MigrationRunnerFailure,
  planOriginOf,
} from '@prisma/orm-sqlite/components/control';
import type { Contract } from '@prisma/orm-sqlite/contract/types';
import { field } from '@prisma/orm-sqlite/contract-builder';
import sqliteDriverDescriptor from '@prisma/orm-sqlite/driver/control';
import sqlFamilyDescriptor, { INIT_ADDITIVE_POLICY } from '@prisma/orm-sqlite/family/control';
import type { SqlStorage } from '@prisma/orm-sqlite/family-contract/types';
import { buildFabricatedMigrationEdge } from '@prisma/orm-sqlite/migration-tools/aggregate';
import { SqlSchemaIR } from '@prisma/orm-sqlite/schema-ir/types';
import sqliteTargetDescriptor from '@prisma/orm-sqlite/target/control';

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: sqliteTargetDescriptor,
  adapter: sqliteAdapterDescriptor,
  driver: sqliteDriverDescriptor,
  extensions: [],
});
const familyInstance = sqlFamilyDescriptor.create(controlStack);
const controlAdapter = sqliteAdapterDescriptor.create(controlStack);

const fw = [sqliteTargetDescriptor, sqliteAdapterDescriptor, sqliteDriverDescriptor] as const;

export const int = field.column(integerColumn);
export const text = field.column(textColumn);
export { integerColumn, textColumn };

export type Driver = {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
};

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-mig-e2e-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  const driver: Driver = {
    familyId: 'sql',
    targetId: 'sqlite',
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      return {
        rows: db.prepare(sql).all(...((params ?? []) as Array<string | number | null>)) as Row[],
      };
    },
    async close() {
      db.close();
    },
  };
  return {
    driver,
    cleanup() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySchema = new SqlSchemaIR({ tables: {} });

function synthEdges(plan: {
  readonly origin?: { readonly storageHash: string } | null;
  readonly destination: { readonly storageHash: string };
  readonly operations: readonly unknown[];
}) {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

export interface MigrationResult {
  readonly driver: Driver;
  readonly schema: SqlSchemaIR;
  readonly operationsExecuted: number;
  /**
   * Operation IDs that the destination plan emitted. Useful when a test
   * needs to verify that a *specific* operation kind (e.g. recreate-table)
   * actually fired, since identical-shaped contracts on either side can
   * still pass schema-level assertions even if the planner suppressed the
   * operation that the test was meant to exercise.
   */
  readonly plannedOperationIds: readonly string[];
}

function formatFailure(f: MigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

interface MigrationOptions {
  origin?: Contract<SqlStorage>;
  destination: Contract<SqlStorage>;
  policy?: MigrationOperationPolicy;
  seed?: (driver: Driver) => Promise<void>;
}

export interface FailedMigrationResult {
  readonly driver: Driver;
  readonly failure: MigrationRunnerFailure;
}

export async function applyMigration(
  options: MigrationOptions,
  runAssertions: (result: MigrationResult) => Promise<void>,
): Promise<void> {
  await runMigration(options, runAssertions, async ({ failure }) => {
    throw new Error(`Destination runner failed: ${formatFailure(failure)}`);
  });
}

/** Applies the destination plan, expects the runner to fail, and hands the failure and the database to `assertFailure`. */
export async function applyMigrationExpectingFailure(
  options: MigrationOptions,
  assertFailure: (result: FailedMigrationResult) => Promise<void>,
): Promise<void> {
  await runMigration(
    options,
    async () => {
      throw new Error('Expected the destination runner to fail, but it succeeded');
    },
    assertFailure,
  );
}

async function runMigration(
  options: MigrationOptions,
  onSuccess: (result: MigrationResult) => Promise<void>,
  onFailure: (result: FailedMigrationResult) => Promise<void>,
): Promise<void> {
  const testDb = createTestDb();
  const { driver } = testDb;
  try {
    const planner = sqliteTargetDescriptor.createPlanner(controlAdapter);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
    const policy = options.policy ?? INIT_ADDITIVE_POLICY;

    let currentSchema: SqlSchemaIR = emptySchema;
    if (options.origin) {
      const r = planner.plan({
        contract: options.origin,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: fw,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (r.kind !== 'success') throw new Error('Origin planner failed');
      const run = await runner.execute({
        driver,
        perSpaceOptions: [
          {
            space: APP_SPACE_ID,
            plan: r.plan,
            migrationEdges: synthEdges(r.plan),
            driver,
            destinationContract: options.origin,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents: fw,
            strictVerification: false,
          },
        ],
      });
      if (!run.ok) throw new Error(`Origin runner failed: ${formatFailure(run.failure)}`);
      currentSchema = await adapter.introspect(driver);
    }
    if (options.seed) await options.seed(driver);

    const planResult = planner.plan({
      contract: options.destination,
      schema: currentSchema,
      policy,
      fromContract: options.origin ?? null,
      origin: planOriginOf(options.origin ?? null),
      statements: [],
      frameworkComponents: fw,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(
        `Destination planner failed: ${planResult.conflicts?.map((cf) => cf.summary).join('; ') ?? 'unknown'}`,
      );
    }
    const runResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver,
          destinationContract: options.destination,
          policy,
          frameworkComponents: fw,
          strictVerification: false,
        },
      ],
    });
    if (!runResult.ok) {
      await onFailure({ driver, failure: runResult.failure });
      return;
    }

    const freshSchema = await adapter.introspect(driver);
    const vr = familyInstance.verifySchema({
      contract: options.destination,
      schema: freshSchema,
      strict: false,
      frameworkComponents: fw,
    });
    if (!vr.ok) {
      const lines = vr.schema.issues.map((i) => `  - ${issueOutcome(i)}: ${i.path.join('/')}`);
      throw new Error(`Schema verification failed:\n${lines.join('\n')}`);
    }

    const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
    for (const [name, tbl] of Object.entries(freshSchema.tables)) {
      if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
    }
    await onSuccess({
      driver,
      schema: new SqlSchemaIR({ ...freshSchema, tables: userTables }),
      operationsExecuted: runResult.value.perSpaceResults[0]?.value.operationsExecuted ?? 0,
      plannedOperationIds: (await Promise.all(planResult.plan.operations)).map((op) => op.id),
    });
  } finally {
    testDb.cleanup();
  }
}
