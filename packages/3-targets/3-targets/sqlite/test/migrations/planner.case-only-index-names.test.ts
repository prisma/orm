/**
 * After a table is renamed by hand, `db update` finds each index named after the old table under a name that differs only in case from the one the contract wants. SQLite compares index names without case, so the old index must be dropped before the new one is created.
 */

import { DatabaseSync } from 'node:sqlite';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { IndexInput } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { contractOf, HANDLE_INDEX_HASH, handleIndex, stubLowerer } from './rename-table-fixtures';

async function plannedLabels(liveIndexTable: string, contractIndexTable: string) {
  const live = contractOf('UserProfile', { indexes: () => [handleIndex(liveIndexTable)] }, 'live');
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: contractOf('UserProfile', { indexes: () => [handleIndex(contractIndexTable)] }, 'to'),
    schema: sqliteContractToSchema(live),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  return (await Promise.all(result.plan.operations)).map((op) => op.label);
}

function exactIndex(name: string, columns: readonly string[]): IndexInput {
  return {
    columns,
    naming: { kind: 'exact', name },
    where: undefined,
    unique: false,
    type: undefined,
    options: undefined,
  };
}

describe('SQLite planner index names that differ only in case', () => {
  it('drops the old index before creating the one whose name differs only in case', async () => {
    expect(await plannedLabels('userProfile', 'UserProfile')).toEqual([
      `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
    ]);
  });

  it('keeps the usual order for an index whose name changes by more than case', async () => {
    expect(await plannedLabels('user_profile', 'UserProfile')).toEqual([
      `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Drop index user_profile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
    ]);
  });

  it('drops the old index first when the name changes only in case and the columns change too, and the plan runs on SQLite', async () => {
    const live = contractOf(
      'UserProfile',
      { indexes: () => [exactIndex('idx_handle', ['handle'])] },
      'live',
    );
    const result = createSqliteMigrationPlanner(stubLowerer).plan({
      contract: contractOf(
        'UserProfile',
        { indexes: () => [exactIndex('Idx_Handle', ['handle', 'email'])] },
        'to',
      ),
      schema: sqliteContractToSchema(live),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const statements = (await Promise.all(result.plan.operations)).flatMap((op) =>
      op.execute.map((step) => step.sql),
    );

    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE "UserProfile" ("id" INTEGER PRIMARY KEY, "email" TEXT, "handle" TEXT)');
      db.exec('CREATE INDEX "idx_handle" ON "UserProfile" ("handle")');
      expect(() => {
        for (const statement of statements) db.exec(statement);
      }).not.toThrow();
      expect(
        db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name`).all(),
      ).toEqual([
        {
          name: 'Idx_Handle',
          sql: 'CREATE INDEX "Idx_Handle" ON "UserProfile" ("handle", "email")',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('keeps the usual order for an index whose name changes only in the case of a non-ASCII letter, which SQLite does not fold', async () => {
    expect(await plannedLabels('Äpfel', 'äpfel')).toEqual([
      `Create index äpfel_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Drop index Äpfel_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
    ]);
  });
});
