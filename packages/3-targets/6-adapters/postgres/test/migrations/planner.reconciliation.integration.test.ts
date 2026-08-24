import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  testTimeout,
} from './fixtures/runner-fixtures';

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function makeContract(
  tables: Record<string, StorageTable>,
  hashSuffix = 'default',
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(`reconciliation-integ-${hashSuffix}`),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function makeTable(columns: Record<string, StorageTable['columns'][string]>): StorageTable {
  return {
    columns,
    primaryKey: { columns: [Object.keys(columns)[0]!] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

async function applyBaseline(
  driver: PostgresControlDriver,
  contract: Contract<SqlStorage>,
): Promise<void> {
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
    throw new Error(`baseline planner failed: ${JSON.stringify(result)}`);
  }
  const executeResult = await runner.execute({
    driver: driver!,
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
    throw new Error(`baseline runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

async function introspectSchema(driver: PostgresControlDriver): Promise<SqlSchemaIRNode> {
  return familyInstance.introspect({ driver });
}

async function planAndExecute(
  driver: PostgresControlDriver,
  contract: Contract<SqlStorage>,
): Promise<void> {
  const schema = await introspectSchema(driver);
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema,
    policy: RECONCILIATION_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success') {
    throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
  }
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver: driver!,
    perSpaceOptions: [
      {
        space: planResult.plan.spaceId ?? APP_SPACE_ID,
        plan: planResult.plan,
        migrationEdges: synthEdges(planResult.plan),
        driver,
        destinationContract: contract,
        policy: RECONCILIATION_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

describe('PostgresMigrationPlanner - reconciliation integration', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('applies ALTER COLUMN TYPE from text to integer', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          value: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'alter-type-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          value: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
        }),
      },
      'alter-type-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = 'item'
              AND a.attname = 'value'
              AND a.atttypid = 'int4'::regtype
              AND NOT a.attisdropped
          ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);
  });

  it('applies SET DEFAULT on a column with no prior default', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'set-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'untitled' },
          },
        }),
      },
      'set-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'config'
             AND column_name = 'label'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('untitled');
  });

  it('drops an extra table', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
        extra: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'drop-table-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-table-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const tableExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.extra') IS NOT NULL AS exists`,
    );
    expect(tableExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra column', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          extra: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-column-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-column-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const colExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'item'
              AND column_name = 'extra'
          ) AS exists`,
    );
    expect(colExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra index', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['name'], name: 'item_name_idx', unique: false }],
          foreignKeys: [],
        },
      },
      'drop-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-index-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_name_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra unique constraint', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            code: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['code'], name: 'item_code_key' }],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-unique-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          code: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'drop-unique-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const constraintExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'item_code_key'
              AND connamespace = 'public'::regnamespace
          ) AS exists`,
    );
    expect(constraintExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra foreign key', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child_parent_id_idx', unique: false }],
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'child',
                columns: ['parent_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'parent',
                columns: ['id'],
              },
              name: 'child_parent_id_fkey',
            },
          ],
        },
      },
      'drop-fk-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'drop-fk-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const fkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'child_parent_id_fkey'
              AND connamespace = 'public'::regnamespace
          ) AS exists`,
    );
    expect(fkExists.rows[0]?.exists).toBe(false);
  });

  it('drops an extra primary key', { timeout: testTimeout }, async () => {
    // Baseline: table with a PK
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-pk-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated: same table without PK
    const updatedContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      'drop-pk-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const pkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'item_pkey'
              AND connamespace = 'public'::regnamespace
              AND contype = 'p'
          ) AS exists`,
    );
    expect(pkExists.rows[0]?.exists).toBe(false);
  });

  it('drops NOT NULL (widens nullability)', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'drop-notnull-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'drop-notnull-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const nullable = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'item'
             AND column_name = 'name'`,
    );
    expect(nullable.rows[0]?.is_nullable).toBe('YES');
  });

  it('sets NOT NULL (tightens nullability)', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'set-notnull-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'set-notnull-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const nullable = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'item'
             AND column_name = 'name'`,
    );
    expect(nullable.rows[0]?.is_nullable).toBe('NO');
  });

  // TML-2089: the existence-only postcheck (IS NOT NULL) passes before the operation runs
  // because the column already has a (wrong) default. The idempotency probe skips SET DEFAULT.
  it.fails('applies ALTER DEFAULT to change an existing column default', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'draft' },
          },
        }),
      },
      'alter-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'active' },
          },
        }),
      },
      'alter-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'config'
             AND column_name = 'status'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('active');
    expect(defaultRow.rows[0]?.column_default).not.toContain('draft');
  });

  // ==========================================================================
  // Compound scenarios — multiple reconciliation operations in a single plan
  // ==========================================================================

  // TML-2135: when type_mismatch and default_mismatch co-occur on the same column, no single
  // two-operation order is safe. The planner must emit three operations: dropDefault → alterType → setDefault.
  it.fails('changes column type and default together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'active' },
          },
        }),
      },
      'compound-type-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            default: { kind: 'literal', value: 1 },
          },
        }),
      },
      'compound-type-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'config'
            AND a.attname = 'status'
            AND a.atttypid = 'int4'::regtype
            AND NOT a.attisdropped
        ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'config'
           AND column_name = 'status'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('1');
  });

  it('tightens nullability and adds a default together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-null-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          label: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'unknown' },
          },
        }),
      },
      'compound-null-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const colInfo = await driver!.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'config'
           AND column_name = 'label'`,
    );
    expect(colInfo.rows[0]?.is_nullable).toBe('NO');
    expect(colInfo.rows[0]?.column_default).not.toBeNull();
    expect(colInfo.rows[0]?.column_default).toContain('unknown');
  });

  it('drops a foreign key and its parent table', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child_parent_id_idx', unique: false }],
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'child',
                columns: ['parent_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'parent',
                columns: ['id'],
              },
              name: 'child_parent_id_fkey',
            },
          ],
        },
      },
      'compound-fk-table-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated contract: keep child table but remove FK, and remove parent table entirely
    const updatedContract = makeContract(
      {
        child: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
      },
      'compound-fk-table-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const fkExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'child_parent_id_fkey'
            AND connamespace = 'public'::regnamespace
        ) AS exists`,
    );
    expect(fkExists.rows[0]?.exists).toBe(false);

    const parentExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.parent') IS NOT NULL AS exists`,
    );
    expect(parentExists.rows[0]?.exists).toBe(false);
  });

  it('drops a column and its index together', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            extra: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['extra'], name: 'item_extra_idx', unique: false }],
          foreignKeys: [],
        },
      },
      'compound-col-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Updated contract: remove the column (and its index)
    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-col-index-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const colExists = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'item'
            AND column_name = 'extra'
        ) AS exists`,
    );
    expect(colExists.rows[0]?.exists).toBe(false);

    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_extra_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(false);
  });

  it('widens and tightens nullability on different columns of the same table', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          col_a: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          col_b: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-mixed-null-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Flip both: col_a becomes nullable (widening), col_b becomes NOT NULL (destructive)
    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          col_a: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          col_b: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      },
      'compound-mixed-null-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const colA = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item'
           AND column_name = 'col_a'`,
    );
    expect(colA.rows[0]?.is_nullable).toBe('YES');

    const colB = await driver!.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item'
           AND column_name = 'col_b'`,
    );
    expect(colB.rows[0]?.is_nullable).toBe('NO');
  });

  it('changes column type when column has an index', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            value: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['value'], name: 'item_value_idx', unique: false }],
          foreignKeys: [],
        },
      },
      'compound-type-with-index-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Change column type but keep the index
    const updatedContract = makeContract(
      {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            value: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['value'], name: 'item_value_idx', unique: false }],
          foreignKeys: [],
        },
      },
      'compound-type-with-index-updated',
    );

    await planAndExecute(driver!, updatedContract);

    // Verify type changed
    const typeRow = await driver!.query<{ matches: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'item'
            AND a.attname = 'value'
            AND a.atttypid = 'int4'::regtype
            AND NOT a.attisdropped
        ) AS matches`,
    );
    expect(typeRow.rows[0]?.matches).toBe(true);

    // Verify index still exists
    const indexExists = await driver!.query<{ exists: boolean }>(
      `SELECT to_regclass('public.item_value_idx') IS NOT NULL AS exists`,
    );
    expect(indexExists.rows[0]?.exists).toBe(true);
  });

  // TML-2089: same as "applies ALTER DEFAULT" — the existence-only postcheck (IS NOT NULL)
  // passes before the operation runs because the column already has a (wrong) default.
  it.fails('changes a literal default to a function default', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          uid: {
            nativeType: 'uuid',
            codecId: 'pg/uuid@1',
            nullable: false,
            default: { kind: 'literal', value: '00000000-0000-0000-0000-000000000000' },
          },
        }),
      },
      'fn-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          uid: {
            nativeType: 'uuid',
            codecId: 'pg/uuid@1',
            nullable: false,
            default: { kind: 'function', expression: 'gen_random_uuid()' },
          },
        }),
      },
      'fn-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item'
           AND column_name = 'uid'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('gen_random_uuid');
  });

  it('applies ALTER COLUMN TYPE between parameterized type variants', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: {
            nativeType: 'character varying',
            codecId: 'pg/varchar@1',
            nullable: true,
            typeParams: { length: 64 },
          },
        }),
      },
      'varchar-typmod-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        item: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          name: {
            nativeType: 'character varying',
            codecId: 'pg/varchar@1',
            nullable: true,
            typeParams: { length: 255 },
          },
        }),
      },
      'varchar-typmod-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const typeRow = await driver!.query<{ formatted_type: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS formatted_type
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname = 'item'
             AND a.attname = 'name'
             AND NOT a.attisdropped`,
    );
    expect(typeRow.rows[0]?.formatted_type).toBe('character varying(255)');
  });

  it('widens nullability and drops default from a NOT NULL DEFAULT column', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'literal', value: 'active' },
          },
        }),
      },
      'compound-widen-drop-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Make nullable, remove default
    const updatedContract = makeContract(
      {
        config: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'compound-widen-drop-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const colInfo = await driver!.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'config'
           AND column_name = 'status'`,
    );
    expect(colInfo.rows[0]?.is_nullable).toBe('YES');
    expect(colInfo.rows[0]?.column_default).toBeNull();
  });

  // ==========================================================================
  // P1-2: Temporal type ALTER COLUMN TYPE reconciliation
  // ==========================================================================

  // planAndExecute succeeds iff the postcheck passes — the postcheck compares
  // buildExpectedFormatType output against PG's format_type(), so success here
  // proves the FORMAT_TYPE_DISPLAY mapping is correct for the target type.

  it('applies ALTER COLUMN TYPE from text to timestamp', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'text-to-timestamp-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: {
            nativeType: 'timestamp',
            codecId: 'pg/timestamp-temporal@1',
            nullable: true,
          },
        }),
      },
      'text-to-timestamp-updated',
    );

    await expect(planAndExecute(driver!, updatedContract)).resolves.not.toThrow();
  });

  it('applies ALTER COLUMN TYPE from text to timestamptz', { timeout: testTimeout }, async () => {
    const baselineContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        }),
      },
      'text-to-timestamptz-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: {
            nativeType: 'timestamptz',
            codecId: 'pg/timestamptz-temporal@1',
            nullable: true,
          },
        }),
      },
      'text-to-timestamptz-updated',
    );

    await expect(planAndExecute(driver!, updatedContract)).resolves.not.toThrow();
  });

  // ==========================================================================
  // P1-3: SET DEFAULT on timestamptz column — postcheck type cast normalization
  // ==========================================================================

  it('applies SET DEFAULT with string literal on a timestamptz column', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: {
            nativeType: 'timestamptz',
            codecId: 'pg/timestamptz-temporal@1',
            nullable: false,
          },
        }),
      },
      'timestamptz-default-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    const updatedContract = makeContract(
      {
        event: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          created_at: {
            nativeType: 'timestamptz',
            codecId: 'pg/timestamptz-temporal@1',
            nullable: false,
            default: { kind: 'literal', value: '2023-01-01T00:00:00.000Z' },
          },
        }),
      },
      'timestamptz-default-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const defaultRow = await driver!.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'event'
           AND column_name = 'created_at'`,
    );
    expect(defaultRow.rows[0]?.column_default).not.toBeNull();
    expect(defaultRow.rows[0]?.column_default).toContain('2023-01-01');
  });

  // ==========================================================================
  // P2-1: Constraint check must be scoped to specific table
  //
  // This test uses the same FK constraint name ("fk_parent") on two tables,
  // which is valid in PG (constraint names are per-table, not per-schema).
  // Introspection reads pg_constraint keyed by conrelid oid, so same-named
  // constraints on different tables never merge.
  // ==========================================================================

  it('drops the correct FK when two tables share a constraint name', {
    timeout: testTimeout,
  }, async () => {
    const baselineContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child1: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child1_parent_id_idx', unique: false }],
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'child1',
                columns: ['parent_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'parent',
                columns: ['id'],
              },
              name: 'fk_parent',
            },
          ],
        },
        child2: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child2_parent_id_idx', unique: false }],
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'child2',
                columns: ['parent_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'parent',
                columns: ['id'],
              },
              name: 'fk_parent',
            },
          ],
        },
      },
      'shared-fk-name-baseline',
    );
    await applyBaseline(driver!, baselineContract);

    // Remove FK from child1 only, keep on child2
    const updatedContract = makeContract(
      {
        parent: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child1: makeTable({
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        }),
        child2: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            parent_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['parent_id'], name: 'child2_parent_id_idx', unique: false }],
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'child2',
                columns: ['parent_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'parent',
                columns: ['id'],
              },
              name: 'fk_parent',
            },
          ],
        },
      },
      'shared-fk-name-updated',
    );

    await planAndExecute(driver!, updatedContract);

    const child1Fk = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE c.conname = 'fk_parent'
            AND t.relname = 'child1'
            AND c.connamespace = 'public'::regnamespace
        ) AS exists`,
    );
    expect(child1Fk.rows[0]?.exists).toBe(false);

    const child2Fk = await driver!.query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE c.conname = 'fk_parent'
            AND t.relname = 'child2'
            AND c.connamespace = 'public'::regnamespace
        ) AS exists`,
    );
    expect(child2Fk.rows[0]?.exists).toBe(true);
  });
});
