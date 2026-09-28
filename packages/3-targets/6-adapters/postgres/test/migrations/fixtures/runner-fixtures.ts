import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
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
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { buildControlTableBootstrapQueries } from '@internal/target-postgres/contract-free';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import type { PostgresDdlNode } from '@internal/target-postgres/ddl';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import { PostgresControlAdapter } from '../../../src/core/control-adapter';
import type { PostgresContract } from '../../../src/core/types';
import postgresAdapterDescriptor from '../../../src/exports/control';

export const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
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

export const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [],
});
export const familyInstance = sqlFamilyDescriptor.create(controlStack);

/**
 * The control adapter instance, constructed once from the control stack — the
 * `Lowerer` the migration planner takes. `postgresTargetDescriptor.createPlanner`
 * accepts the adapter directly (not the family).
 */
export const controlAdapter = postgresAdapterDescriptor.create(controlStack);

export const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
] as const;

export const testTimeout = timeouts.spinUpPpgDev;

export type PostgresControlDriver = Awaited<ReturnType<typeof postgresDriverDescriptor.create>>;

export async function resetDatabase(driver: PostgresControlDriver): Promise<void> {
  await driver.query('drop schema if exists public cascade');
  await driver.query('drop schema if exists prisma_contract cascade');
  await driver.query('create schema public');
}

export function createFailingPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
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
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'user',
          },
        },
        precheck: [
          {
            description: 'always false',
            sql: 'SELECT FALSE',
          },
        ],
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

export function createLedgerTestPlan<TDetails extends PostgresPlanTargetDetails>(options: {
  readonly destinationHash: string;
  readonly operations: readonly SqlMigrationPlanOperation<TDetails>[];
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
}) {
  return createMigrationPlan<TDetails>({
    targetId: 'postgres',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash, profileHash: contract.profileHash },
    operations: options.operations,
    providedInvariants: [],
  });
}

const postgresControlAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const postgresControlLowererContext = { contract: {} as PostgresContract };

export async function bootstrapPostgresControlSchema(driver: PostgresControlDriver): Promise<void> {
  const schemaQuery = buildControlTableBootstrapQueries()[0];
  if (!schemaQuery) {
    throw new Error('expected prisma_contract schema bootstrap query');
  }
  const postgresSchemaQuery = schemaQuery as unknown as PostgresDdlNode;
  await executeStatement(
    driver,
    await postgresControlAdapter.lowerToExecuteRequest(
      postgresSchemaQuery,
      postgresControlLowererContext,
    ),
  );
}

export async function bootstrapPostgresControlTables(driver: PostgresControlDriver): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    const postgresQuery = query as unknown as PostgresDdlNode;
    await executeStatement(
      driver,
      await postgresControlAdapter.lowerToExecuteRequest(
        postgresQuery,
        postgresControlLowererContext,
      ),
    );
  }
}

export async function executeStatement(
  driver: PostgresControlDriver,
  statement: SqlExecuteRequest,
): Promise<void> {
  if (statement.params && statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}

export interface TestContext {
  database: Awaited<ReturnType<typeof createDevDatabase>>;
  driver: PostgresControlDriver | undefined;
}

export async function createTestDatabase(): Promise<Awaited<ReturnType<typeof createDevDatabase>>> {
  return createDevDatabase();
}

export async function createDriver(connectionString: string): Promise<PostgresControlDriver> {
  return postgresDriverDescriptor.create(connectionString);
}

/**
 * Formats a runner failure into a human-readable string for test error messages.
 * Includes code, summary, why, and meta (with issues) for easy debugging.
 */
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

export { createMigrationPlan, postgresDriverDescriptor, postgresTargetDescriptor };
