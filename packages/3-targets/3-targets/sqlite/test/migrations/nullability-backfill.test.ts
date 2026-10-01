import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { SqlTableIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: '', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

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
      storageHash: coreHash('c'.repeat(64)),
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

// Live schema where "users.email" is nullable. Contract below will tighten
// it to NOT NULL.
function nullableEmailSchema(): { tables: Record<string, SqlTableIR> } {
  return {
    tables: {
      users: new SqlTableIR({
        name: 'users',
        columns: {
          id: {
            name: 'id',
            nativeType: 'INTEGER',
            resolvedNativeType: 'integer',
            nullable: false,
          },
          email: {
            name: 'email',
            nativeType: 'TEXT',
            resolvedNativeType: 'text',
            nullable: true,
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
    },
  };
}

function tightenedEmailContract() {
  return makeContract({
    users: makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
        email: makeColumn({ nativeType: 'text', nullable: false }),
      },
      primaryKey: { columns: ['id'] },
    }),
  });
}

describe('nullability-tightening backfill', async () => {
  const planner = createSqliteMigrationPlanner(stubLowerer);

  it("without 'data' in policy, recreate alone runs and would fail at runtime on NULLs", async () => {
    const result = planner.plan({
      contract: tightenedEmailContract(),
      schema: nullableEmailSchema(),
      policy: { allowedOperationClasses: ['additive', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const ops = await Promise.all(result.plan.operations);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('recreateTable.users');
    expect(ops[0]?.operationClass).toBe('destructive');
  });

  it("with 'data' allowed, emits a backfill data-transform stub before the recreate", async () => {
    const result = planner.plan({
      contract: tightenedEmailContract(),
      schema: nullableEmailSchema(),
      policy: { allowedOperationClasses: ['additive', 'destructive', 'data'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Accessing operations throws because the DataTransformCall stub's
    // toOp() unconditionally throws MIGRATION.UNFILLED_PLACEHOLDER — the user must fill the
    // rendered migration.ts before the plan is executable. This mirrors
    // Postgres's behavior.
    expect(() => result.plan.operations).toThrowError(/unfilled/i);

    // The rendered TypeScript contains the dataTransform placeholder and
    // the recreate follows it.
    const ts = result.plan.renderTypeScript(keepInternalSpecifiers);
    const backfillIdx = ts.indexOf('dataTransform(');
    const recreateIdx = ts.indexOf('recreateTable(');
    expect(backfillIdx).toBeGreaterThan(-1);
    expect(recreateIdx).toBeGreaterThan(-1);
    expect(backfillIdx).toBeLessThan(recreateIdx);
    expect(ts).toContain('placeholder("users-email-backfill-sql")');
  });

  it("relaxing NOT NULL → nullable does not emit a backfill even with 'data' allowed", async () => {
    // Swap: schema is NOT NULL, contract wants nullable.
    const schema = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: {
              name: 'id',
              nativeType: 'INTEGER',
              resolvedNativeType: 'integer',
              nullable: false,
            },
            email: {
              name: 'email',
              nativeType: 'TEXT',
              resolvedNativeType: 'text',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          email: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema,
      policy: { allowedOperationClasses: ['additive', 'widening', 'data'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // No data transform — just a widening recreate.
    const ops = await Promise.all(result.plan.operations);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('recreateTable.users');
    expect(ops[0]?.operationClass).toBe('widening');
  });
});
