import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { index } from '@internal/sql-contract/factories';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

function makeContract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(`test-${Date.now()}`),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
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

const emptySchema = { tables: {} };

describe('SQLite migration planner', () => {
  const planner = createSqliteMigrationPlanner(
    new SqliteControlAdapter(createSqliteBuiltinCodecLookup()),
  );

  it('plans CREATE TABLE for new table', async () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];
    expect(ops.length).toBeGreaterThanOrEqual(1);
    const tableOp = ops.find((op) => op.id === 'table.users');
    expect(tableOp).toBeDefined();
    expect(tableOp!.execute[0]!.sql).toContain('CREATE TABLE');
    expect(tableOp!.execute[0]!.sql).toContain('"users"');
  });

  it('plans ADD COLUMN for existing table', async () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
          bio: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const existingSchema = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'integer', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };

    const result = planner.plan({
      contract,
      schema: existingSchema,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];
    const colOp = ops.find((op) => op.id === 'column.users.bio');
    expect(colOp).toBeDefined();
    expect(colOp!.execute[0]!.sql).toContain('ADD COLUMN "bio"');
  });

  it('plans CREATE INDEX', async () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          email: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
        indexes: [index('idx_users_email', ['email'])],
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];
    const indexOp = ops.find((op) => op.id === 'index.users.idx_users_email');
    expect(indexOp).toBeDefined();
    expect(indexOp!.execute[0]!.sql).toContain('CREATE INDEX');
  });

  it('fails without additive policy', () => {
    const contract = makeContract({});
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: [] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('failure');
  });
});
