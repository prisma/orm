import postgresAdapterControl, {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const frameworkComponents = [postgresTargetControl, postgresAdapterControl];

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControlPolicy?: Contract<SqlStorage>['defaultControlPolicy'],
): Contract<SqlStorage> {
  const unboundNs = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: tables },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  };
}

const baseColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };
const nullableColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: true };

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const testAdapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);
const planner = createPostgresMigrationPlanner(testAdapter);

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {},
    }),
  },
  roles: [],
  existingSchemas: [],
  pgVersion: '',
});

function liveSchemaWithUsers(
  columns: Record<string, { name: string; nativeType: string; nullable: boolean }>,
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          users: new PostgresTableSchemaNode({
            name: 'users',
            columns,
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: [],
    pgVersion: '',
  });
}

async function planAgainst(contract: Contract<SqlStorage>, schema: PostgresDatabaseSchemaNode) {
  const result = planner.plan({
    contract,
    schema,
    policy: RECONCILIATION_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('expected planner success');
  const operations = await Promise.all(result.plan.operations);
  return { operations, warnings: result.warnings };
}

// Exercises the input-side partition that gates the planner: the live
// schema → verify → partition → plan path. Control-policy filtering is no
// longer a post-pass on generated DDL; subjects governed by `external` /
// `observed`, and non-creation issues for `tolerated` subjects, never enter
// `planIssues`. The tests pin "this subject's diff never ran" by asserting
// zero operations and the corresponding suppressed-subject warning.
describe('PostgresMigrationPlanner.plan control-policy partitioning', async () => {
  describe('managed', async () => {
    const contract = makeContract({
      users: {
        columns: { id: baseColumn, email: baseColumn },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits createTable when the live schema is empty', async () => {
      const { operations } = await planAgainst(contract, emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });
  });

  describe('tolerated', async () => {
    function toleratedContract(extraColumns: Record<string, typeof baseColumn> = {}) {
      return makeContract({
        users: {
          control: 'tolerated',
          columns: { id: baseColumn, ...extraColumns },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      });
    }

    it('emits createTable for an entirely-absent tolerated table', async () => {
      const { operations } = await planAgainst(toleratedContract(), emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });

    it('skips diffing an existing tolerated table — no DDL even when contract adds a column', async () => {
      // Live DB has `users(id)`; contract adds nullable `email`. Under
      // tolerated semantics, the missing-column issue is suppressed at the
      // input partition.
      const contract = toleratedContract({ email: nullableColumn });
      const live = liveSchemaWithUsers({ id: { name: 'id', nativeType: 'text', nullable: false } });
      const result = await planAgainst(contract, live);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'tolerated'",
            ),
          }),
        ]),
      );
    });

    it('emits createTable for a tolerated table whose live shape is absent (diff engine is short-circuited)', async () => {
      // The diff engine never sees an existing tolerated table — it only
      // ever sees the create path. This pins the create-if-absent semantic.
      const contract = toleratedContract({ email: nullableColumn });
      const { operations } = await planAgainst(contract, emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });
  });

  describe('external', async () => {
    const contract = makeContract({
      users: {
        control: 'external',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits zero DDL and one suppressed-subject warning, regardless of live state', async () => {
      const result = await planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'external'",
            ),
          }),
        ]),
      );
    });
  });

  describe('observed', async () => {
    const contract = makeContract({
      users: {
        control: 'observed',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits zero DDL and one suppressed-subject warning', async () => {
      const result = await planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'observed'",
            ),
          }),
        ]),
      );
    });
  });

  describe('external defaultControlPolicy floor', async () => {
    it('suppresses managed-override object DDL (the floor wins) and emits the floor warning', async () => {
      const contract = makeContract(
        {
          users: {
            control: 'managed',
            columns: { id: baseColumn },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        'external',
      );
      const result = await planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "has effective control 'external' but declared 'managed'",
            ),
          }),
        ]),
      );
    });
  });
});

// Mirror of the planner-level gating tests from before the input-side
// refactor: control policy partitions at the planner's entry point, so a
// `tolerated` table that already exists in the database may grow new objects
// but never be modified in place. The same diff under `managed` emits the
// add-column.
describe('PostgresMigrationPlanner.plan tolerated vs managed add-column', async () => {
  const liveSchemaWithUsersIdOnly: PostgresDatabaseSchemaNode = liveSchemaWithUsers({
    id: { name: 'id', nativeType: 'text', nullable: false },
  });

  async function planAddColumn(control: 'managed' | 'tolerated') {
    const contract = makeContract({
      users: {
        control,
        columns: { id: baseColumn, email: nullableColumn },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = planner.plan({
      contract,
      schema: liveSchemaWithUsersIdOnly,
      policy: RECONCILIATION_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: 'app',
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    return await Promise.all(result.plan.operations);
  }

  it('suppresses a tolerated table add-column', async () => {
    const operations = await planAddColumn('tolerated');
    expect(operations).toHaveLength(0);
  });

  it('emits the add-column when the same table is managed', async () => {
    const operations = await planAddColumn('managed');
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'column.__unbound__.users.email',
          operationClass: 'additive',
        }),
      ]),
    );
  });
});
