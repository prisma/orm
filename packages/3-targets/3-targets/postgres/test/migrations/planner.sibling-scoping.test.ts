/**
 * Unit tests for the Postgres planner's ownership consultation: the aggregate
 * orchestration hands `plan()` an ownership oracle (the passive aggregate,
 * satisfying `SchemaOwnership`). For each live extra node the planner asks the
 * oracle whether any contract space owns it — a sibling-owned table is left
 * untouched, a truly-unclaimed table is dropped under a destructive policy.
 * No sibling-name list, no keep-predicate: ownership lives in the aggregate.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { coordinateKey, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  renderColumnDefault: async () => '',
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function buildContract(): Contract<SqlStorage> {
  const schema = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        app_user: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sibling-scoping-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sibling-scoping-test'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function buildLiveSchema(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          app_user: new PostgresTableSchemaNode({
            name: 'app_user',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
          cipher_state: new PostgresTableSchemaNode({
            name: 'cipher_state',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
          orphan_table: new PostgresTableSchemaNode({
            name: 'orphan_table',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

/**
 * A contract declaring two namespaces: the default (`public`) with
 * `app_user`, and a second real namespace `tenant_b` with its own declared
 * table (`tenant_meta` — so the namespace is not table-less and is not
 * pruned from the expected tree before the differ runs, letting a
 * per-table extra inside it reach `retainUnownedExtras`), but no
 * `orphan_table`.
 */
function buildContractWithSecondNamespace(): Contract<SqlStorage> {
  const publicSchema = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        app_user: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: {},
    },
  });
  const tenantBSchema = postgresCreateNamespace({
    id: 'tenant_b',
    entries: {
      table: {
        tenant_meta: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sibling-scoping-cross-namespace-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sibling-scoping-cross-namespace-test'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: publicSchema, tenant_b: tenantBSchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

/**
 * The live schema matching {@link buildContractWithSecondNamespace}, plus a
 * live `orphan_table` in `tenant_b` this space's contract does not declare.
 */
function buildLiveSchemaWithCrossNamespaceOrphan(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          app_user: new PostgresTableSchemaNode({
            name: 'app_user',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
        },
      }),
      tenant_b: new PostgresNamespaceSchemaNode({
        schemaName: 'tenant_b',
        tables: {
          tenant_meta: new PostgresTableSchemaNode({
            name: 'tenant_meta',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
          orphan_table: new PostgresTableSchemaNode({
            name: 'orphan_table',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public', 'tenant_b'],
    pgVersion: 'unknown',
  });
}

// An ownership oracle in which every named entity is owned by some contract
// space at its exact schema-IR entity coordinate — as if the aggregate
// declared `public.cipher_state` (a sibling's table).
const ownsOnly = (...coordinates: readonly SchemaEntityCoordinate[]): SchemaOwnership => {
  const owned = new Set(coordinates.map(coordinateKey));
  return { declaresEntity: (coordinate) => owned.has(coordinateKey(coordinate)) };
};

/**
 * The coordinate a sibling space's own default (unbound) namespace would
 * declare this entity at. A live table resolves to the `public` DDL
 * schema, but a contract space that never names an explicit namespace
 * declares its entities under the raw `UNBOUND_NAMESPACE_ID` sentinel —
 * the planner recovers that same raw id from the resolved DDL schema
 * (`resolveNamespaceIdForDdlSchema`) before consulting the oracle, so the
 * oracle must be built on this same coordinate to match. Defaults to
 * `entityKind: 'table'` since every existing test here is about tables.
 */
const inPublic = (entityName: string, entityKind = 'table'): SchemaEntityCoordinate => ({
  namespaceId: UNBOUND_NAMESPACE_ID,
  entityKind,
  entityName,
});

describe('Postgres planner ownership consultation', () => {
  it('drops every unclaimed table under a destructive policy when no ownership oracle is supplied', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds.sort()).toEqual(['dropTable.cipher_state', 'dropTable.orphan_table']);
  });

  it('never drops a table another space owns, but still drops a truly unclaimed one', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    // The aggregate declares `app_user` (this space) and `cipher_state` (a
    // sibling); `orphan_table` is owned by nobody.
    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsOnly(inPublic('app_user'), inPublic('cipher_state')),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });

  it('never drops anything additive-only, regardless of ownership', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });

  it('drops an extra column on a table this space owns even when the oracle declares that table', async () => {
    // Ownership is consulted only for whole extra TABLES. A drifted column on
    // `app_user` (a table this space owns and the oracle declares) is this
    // space's own drift and must still be dropped — the oracle's positive
    // answer on the owning table must not suppress it.
    const liveWithDriftColumn = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            app_user: new PostgresTableSchemaNode({
              name: 'app_user',
              columns: {
                id: { name: 'id', nativeType: 'int4', nullable: false },
                legacy_col: { name: 'legacy_col', nativeType: 'text', nullable: true },
              },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: 'unknown',
    });

    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContract(),
      schema: liveWithDriftColumn,
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsOnly(inPublic('app_user')),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropColumnIds = ops.filter((op) => op.id.startsWith('dropColumn.')).map((op) => op.id);
    expect(dropColumnIds).toEqual(['dropColumn.app_user.legacy_col']);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });

  it('drops a same-named table in an unowned namespace even when a sibling owns that name elsewhere', async () => {
    // `tenant_b.orphan_table` is a genuine orphan — no space declares it. The
    // oracle DOES declare a same-named `public.orphan_table` (a sibling's
    // table in a different namespace). A bare-name-only ownership check
    // would wrongly treat the two as the same entity and retain the
    // tenant_b table; namespace-qualified matching must still drop it.
    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContractWithSecondNamespace(),
      schema: buildLiveSchemaWithCrossNamespaceOrphan(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsOnly(inPublic('app_user'), inPublic('orphan_table')),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });

  it('drops a table extra even when the oracle declares a same-named entity of a different kind', async () => {
    // The oracle declares `orphan_table` — but as a value set (an enum-like
    // entity), not a table. Ownership must match on entity kind, not just
    // namespace and name: a same-named non-table declaration does not make
    // the live orphan_table TABLE owned, so it is still dropped.
    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsOnly(
        inPublic('app_user'),
        inPublic('cipher_state'),
        inPublic('orphan_table', 'valueSet'),
      ),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });
});
