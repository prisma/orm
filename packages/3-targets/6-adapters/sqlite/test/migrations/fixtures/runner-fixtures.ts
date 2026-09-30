import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import sqliteDriverDescriptor from '@internal/driver-sqlite/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  type SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationPlan,
  type MigrationRunnerFailure,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { buildControlTableBootstrapQueries } from '@internal/target-sqlite/contract-free';
import sqliteTargetDescriptor, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import type { SqliteDdlNode } from '@internal/target-sqlite/ddl';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { applicationDomainOf } from '@repo/test-utils';
import { SqliteControlAdapter } from '../../../src/core/control-adapter';
import type { SqliteContract } from '../../../src/core/types';
import sqliteAdapterDescriptor from '../../../src/exports/control';

export const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
                email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }],
              indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

export const emptySchema = new SqlSchemaIR({
  tables: {},
});

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: sqliteTargetDescriptor,
  adapter: sqliteAdapterDescriptor,
  driver: sqliteDriverDescriptor,
  extensions: [],
});
export const familyInstance = sqlFamilyDescriptor.create(controlStack);
export const controlAdapter = sqliteAdapterDescriptor.create(controlStack);

export const frameworkComponents = [
  sqliteTargetDescriptor,
  sqliteAdapterDescriptor,
  sqliteDriverDescriptor,
] as const;

export type SqliteControlDriver = {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
};

export interface TestDatabase {
  readonly driver: SqliteControlDriver & { db: DatabaseSync };
  readonly path: string;
  cleanup(): void;
}

export function createTestDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  const driver: SqliteControlDriver & { db: DatabaseSync } = {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    db,
  };

  return {
    driver,
    path: dbPath,
    cleanup() {
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function createFailingPlan() {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: APP_SPACE_ID,
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Failing operation',
        summary: 'Precheck always fails',
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: { schema: 'main', objectType: 'table', name: 'user' },
        },
        precheck: [{ description: 'always false', sql: 'SELECT 0' }],
        execute: [],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

export function toPlanContractInfo(c: Contract<SqlStorage>) {
  return { storageHash: c.storage.storageHash, profileHash: c.profileHash };
}

export function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

export const LEDGER_TEST_SPACE_ID = 'ledger-test';

export function createLedgerTestPlan(options: {
  readonly destinationHash: string;
  readonly operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
}) {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash, profileHash: contract.profileHash },
    operations: options.operations,
    providedInvariants: [],
  });
}

const sqliteControlAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
const sqliteControlLowererContext = { contract: {} as SqliteContract };

export async function bootstrapSqliteControlTables(driver: SqliteControlDriver): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    const sqliteQuery = query as unknown as SqliteDdlNode;
    await executeStatement(
      driver,
      await sqliteControlAdapter.lowerToExecuteRequest(sqliteQuery, sqliteControlLowererContext),
    );
  }
}

export async function executeStatement(
  driver: SqliteControlDriver,
  statement: SqlExecuteRequest,
): Promise<void> {
  if (statement.params && statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}

export function formatRunnerFailure(failure: MigrationRunnerFailure): string {
  const parts = [`[${failure.code}] ${failure.summary}`];
  if (failure.why) {
    parts.push(`  why: ${failure.why}`);
  }
  if (failure.meta) {
    const issues = failure.meta['issues'];
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        parts.push(`  - ${JSON.stringify(issue)}`);
      }
    } else {
      parts.push(`  meta: ${JSON.stringify(failure.meta, null, 2)}`);
    }
  }
  return parts.join('\n');
}

export async function expectNoMarkerOrLedgerWrites(driver: SqliteControlDriver): Promise<void> {
  const markerExists = await driver.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_prisma_marker'",
  );
  if (markerExists.rows[0]!.cnt > 0) {
    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker',
    );
    if (markerCount.rows[0]!.cnt !== 0) {
      throw new Error(`Expected no marker writes but found ${markerCount.rows[0]!.cnt} rows`);
    }
  }

  const ledgerExists = await driver.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_prisma_ledger'",
  );
  if (ledgerExists.rows[0]!.cnt > 0) {
    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    if (ledgerCount.rows[0]!.cnt !== 0) {
      throw new Error(`Expected no ledger writes but found ${ledgerCount.rows[0]!.cnt} rows`);
    }
  }
}

export { createMigrationPlan, sqliteDriverDescriptor, sqliteTargetDescriptor };
