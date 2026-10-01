/**
 * `this.renameTable` in a hand-written SQLite migration. It reads the migration's start and end contracts and emits the table rename, then drops each index whose wire name derives from the old table name and creates it under the new name, because SQLite cannot rename an index. SQLite names no primary key, unique constraint or foreign key the contract leaves unnamed, so those need nothing. A table missing from either contract is refused.
 */

import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new SqliteContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

function renameMigration(
  start: Contract<SqlStorage> | null,
  end: Contract<SqlStorage>,
  rename: { readonly table: string; readonly to: string },
): { readonly operations: readonly Promise<Op>[] } {
  const endJson = jsonOf(end);
  class WithoutStart extends SqliteMigration {
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return [...this.renameTable(rename)];
    }
  }
  if (start === null) return new WithoutStart(stack);
  const startJson = jsonOf(start);
  class WithStart extends WithoutStart {
    override readonly startContractJson = startJson;
  }
  return new WithStart(stack);
}

const RENAME = { table: 'userProfile', to: 'UserProfile' } as const;

async function renameLabels(spec: ProfileSpec): Promise<readonly string[]> {
  const ops = await Promise.all(
    renameMigration(
      contractOf('userProfile', spec, 'from'),
      contractOf('UserProfile', spec, 'to'),
      RENAME,
    ).operations,
  );
  return ops.map((op) => op.label);
}

describe('SqliteMigration.renameTable', () => {
  it('drops an index whose prefix derives from the table name, then creates it under the new name', async () => {
    expect(await renameLabels({ indexes: (tableName) => [handleIndex(tableName)] })).toEqual([
      'Rename table userProfile to UserProfile',
      `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
    ]);
  });

  it('emits the rename alone for an unnamed unique, an owned foreign key and a referencing foreign key', async () => {
    expect(
      await renameLabels({
        uniques: [{ columns: ['email'] }],
        foreignKeys: (tableName) => [
          { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
        ],
      }),
    ).toEqual(['Rename table userProfile to UserProfile']);
  });

  it('leaves an explicitly named index alone', async () => {
    expect(
      await renameLabels({
        indexes: (tableName) => [
          { ...handleIndex(tableName), naming: { kind: 'exact', name: 'profile_handle' } },
        ],
      }),
    ).toEqual(['Rename table userProfile to UserProfile']);
  });

  it('renames through a temporary name when only the case changes', async () => {
    const [rename] = await Promise.all(
      renameMigration(
        contractOf('userProfile', {}, 'from'),
        contractOf('UserProfile', {}, 'to'),
        RENAME,
      ).operations,
    );

    expect(rename?.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"',
      'ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('refuses a table the start contract does not have', () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          {
            table: 'ghost',
            to: 'UserProfile',
          },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining('table "ghost" does not exist in the start contract'),
      }),
    );
  });

  it('refuses a new name the end contract does not have', () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          {
            table: 'userProfile',
            to: 'Profile',
          },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining('table "Profile" does not exist in the end contract'),
      }),
    );
  });

  it('refuses in a migration without a start contract', () => {
    expect(
      () => renameMigration(null, contractOf('UserProfile', {}, 'to'), RENAME).operations,
    ).toThrow(expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_UNMATCHED' }));
  });
});
