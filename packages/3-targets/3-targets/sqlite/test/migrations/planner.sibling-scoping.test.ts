/**
 * Unit tests for the SQLite planner's ownership consultation: the aggregate
 * orchestration hands `plan()` an ownership oracle (the passive aggregate,
 * satisfying `SchemaOwnership`). For each live extra node the planner asks the
 * oracle whether any contract space owns it — a sibling-owned table is left
 * untouched, a truly-unclaimed table is dropped under a destructive policy.
 * No sibling-name list, no keep-predicate: ownership lives in the aggregate.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { coordinateKey, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sibling-scoping-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sibling-scoping-test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              app_user: {
                columns: {
                  id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
                },
                uniques: [],
                indexes: [],
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
}

function buildLiveSchema(): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      app_user: {
        name: 'app_user',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      cipher_state: {
        name: 'cipher_state',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      orphan_table: {
        name: 'orphan_table',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
  });
}

// An ownership oracle in which every named entity is owned by some contract
// space — as if the aggregate declared `cipher_state` (a sibling's table).
// SQLite is a single-namespace target, so every declared entity is
// implicitly qualified with `UNBOUND_NAMESPACE_ID`.
const ownsOnly = (...coordinates: readonly SchemaEntityCoordinate[]): SchemaOwnership => {
  const owned = new Set(coordinates.map(coordinateKey));
  return { declaresEntity: (coordinate) => owned.has(coordinateKey(coordinate)) };
};

/** A table coordinate in SQLite's sole (unbound) namespace — the common case. */
const table = (entityName: string): SchemaEntityCoordinate => ({
  namespaceId: UNBOUND_NAMESPACE_ID,
  entityKind: 'table',
  entityName,
});

describe('SQLite planner ownership consultation', () => {
  it('drops every unclaimed table under a destructive policy when no ownership oracle is supplied', async () => {
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
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
    const planner = createSqliteMigrationPlanner(stubLowerer);

    // The aggregate declares `app_user` (this space) and `cipher_state` (a
    // sibling); `orphan_table` is owned by nobody.
    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ownership: ownsOnly(table('app_user'), table('cipher_state')),
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });

  it('never drops anything additive-only, regardless of ownership', async () => {
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive'] },
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
    // answer on the owning table must not suppress it, and the table itself is
    // never dropped.
    const liveWithDriftColumn = new SqlSchemaIR({
      tables: {
        app_user: {
          name: 'app_user',
          columns: {
            id: { name: 'id', nativeType: 'integer', nullable: false },
            legacy_col: { name: 'legacy_col', nativeType: 'text', nullable: true },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const planner = createSqliteMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContract(),
      schema: liveWithDriftColumn,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ownership: ownsOnly(table('app_user')),
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropColumnIds = ops.filter((op) => op.id.startsWith('dropColumn.')).map((op) => op.id);
    expect(dropColumnIds).toEqual(['dropColumn.app_user.legacy_col']);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });

  it('drops a table extra even when the oracle declares a same-named entity of a different kind', async () => {
    // The oracle declares `orphan_table` — but as a value set (an enum-like
    // entity), not a table. Ownership must match on entity kind, not just
    // name: a same-named non-table declaration does not make the live
    // orphan_table TABLE owned, so it is still dropped.
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ownership: ownsOnly(table('app_user'), table('cipher_state'), {
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityKind: 'valueSet',
        entityName: 'orphan_table',
      }),
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });
});
