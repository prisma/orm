/**
 * A unique constraint (`pg_constraint`) and an index (`pg_index`) are distinct
 * structural nodes with distinct id namespaces (`unique:<cols>` vs
 * `index:<cols>`), so the differ never pairs one kind against the other. These
 * tests pin the planner behaviour that falls out of that:
 *
 * - A contract `@@unique` against a live unique *index* is a missing constraint
 *   plus an extra index. Under an additive policy the constraint is added and
 *   the destructive index drop is suppressed by the control-policy disposition.
 * - A contract `@@index` against a live unique *index* pairs (both are index
 *   nodes) but differs on `unique`, an incompatible index change.
 * - A contract `@@index` against a live unique *constraint* is a missing index
 *   plus an extra constraint. Under an additive policy the index is created and
 *   the destructive constraint drop is suppressed.
 * - Names never drive equality: a unique constraint compares by id-identity and
 *   an index by its structural options, so name-only differences emit nothing.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

describe('PostgresMigrationPlanner - unique constraints vs indexes (structural nodes)', () => {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );

  const emailCols = {
    id: { name: 'id', nativeType: 'uuid', nullable: false },
    email: { name: 'email', nativeType: 'text', nullable: false },
  } as const;

  function liveSchema(table: {
    readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
    readonly indexes?: readonly {
      readonly columns: readonly string[];
      readonly unique: boolean;
      readonly name: string;
    }[];
  }): PostgresDatabaseSchemaNode {
    return new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: emailCols,
              primaryKey: { columns: ['id'] },
              uniques: table.uniques ?? [],
              foreignKeys: [],
              indexes: (table.indexes ?? []).map(({ name, ...i }) => ({
                ...i,
                naming: { kind: 'exact' as const, name },
                where: undefined,
                partial: false,
                type: undefined,
                options: undefined,
                annotations: undefined,
                dependsOn: undefined,
              })),
              policies: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      pgVersion: '',
      roles: [],
      existingSchemas: [],
    });
  }

  function planAdditive(contract: Contract<SqlStorage>, schema: PostgresDatabaseSchemaNode) {
    return planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  it('contract @@unique against a live unique index adds the constraint and suppresses the index drop', async () => {
    const contract = createTestContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [],
        foreignKeys: [],
      },
    });
    const schema = liveSchema({
      indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }],
    });

    const result = planAdditive(contract, schema);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => ({ id: op.id, operationClass: op.operationClass }))).toEqual([
      { id: 'unique.user.user_email_key', operationClass: 'additive' },
    ]);
  });

  it('contract @@index against a live unique index is an incompatible index change', () => {
    const contract = createTestContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
        foreignKeys: [],
      },
    });
    const schema = liveSchema({
      indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }],
    });

    const result = planAdditive(contract, schema);

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') throw new Error('expected planner failure');
    expect(result.conflicts).toEqual([expect.objectContaining({ kind: 'indexIncompatible' })]);
  });

  it('contract @@index against a live unique constraint creates the index and suppresses the constraint drop', async () => {
    const contract = createTestContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
        foreignKeys: [],
      },
    });
    const schema = liveSchema({ uniques: [{ columns: ['email'], name: 'user_email_key' }] });

    const result = planAdditive(contract, schema);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => ({ id: op.id, operationClass: op.operationClass }))).toEqual([
      { id: 'index.user.user_email_idx', operationClass: 'additive' },
    ]);
  });

  it('a unique-constraint name difference emits nothing; an index name difference plans the contract index (additive half — rename pairing is a widening pass)', async () => {
    const contract = createTestContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'], name: 'user_pk' },
        uniques: [{ columns: ['email'], name: 'user_email_unique' }],
        indexes: [{ columns: ['email'], name: 'user_email_index', unique: false }],
        foreignKeys: [],
      },
    });
    const schema = liveSchema({
      uniques: [{ columns: ['email'], name: 'user_email_key' }],
      indexes: [{ columns: ['email'], unique: false, name: 'user_email_idx' }],
    });

    const result = planAdditive(contract, schema);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    // Uniques stay tuple-identified: the constraint name difference pairs and
    // emits nothing. Indexes are name-identified: the differently-named
    // contract index is missing, so its CREATE is planned (the live index's
    // DROP is not additive; a widening rename pass converges the pair).
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => ({ id: op.id, operationClass: op.operationClass }))).toEqual([
      { id: 'index.user.user_email_index', operationClass: 'additive' },
    ]);
  });
});

function createTestContract(tables: Record<string, StorageTableInput> = {}): Contract<SqlStorage> {
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
  };
}
