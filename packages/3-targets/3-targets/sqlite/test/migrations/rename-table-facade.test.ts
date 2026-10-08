/**
 * `this.renameTable` in a hand-written SQLite migration. It resolves the old name against the
 * schema as the migration's earlier renames leave it and the new name against the end contract, and
 * emits the table rename, then drops each index whose wire name derives from the old table name and
 * creates it under the new name, because SQLite cannot rename an index. SQLite names no primary
 * key, unique constraint or foreign key the contract leaves unnamed, so those need nothing.
 */

import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { Migration } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import { sqliteTestComponents } from '../sqlite-test-types';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  plainTable,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: sqliteTestComponents,
} as unknown as ControlStack<'sql', 'sqlite'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new SqliteContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

type TableRenameOptions = { readonly table: string; readonly to: string };

function renameMigration(
  start: Contract<SqlStorage> | null,
  end: Contract<SqlStorage>,
  rename: TableRenameOptions,
  ...more: readonly TableRenameOptions[]
): SqliteMigration & { readonly operations: readonly Promise<Op>[] } {
  const endJson = jsonOf(end);
  class WithoutStart extends SqliteMigration {
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return [rename, ...more].flatMap((each) => this.renameTable(each));
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
const derivedIndex: ProfileSpec = { indexes: (tableName) => [handleIndex(tableName)] };

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

  it('refuses a table that does not exist at this point of the migration', () => {
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
        message: expect.stringContaining(
          'table "ghost" does not exist at this point of the migration',
        ),
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

  it('refuses a new name that already exists at this point of the migration', () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          { table: 'userProfile', to: 'account' },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining(
          'table "account" already exists at this point of the migration',
        ),
      }),
    );
  });

  it('refuses a new name another table holds in another case, since SQLite ignores case', () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          { table: 'userProfile', to: 'Account' },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining(
          'table "Account" already exists at this point of the migration as "account"',
        ),
      }),
    );
  });

  it('renames a table twice in one migration when the end contract declares both new names, each rename from where the last left it', async () => {
    const ops = await Promise.all(
      renameMigration(
        contractOf('userProfile', derivedIndex, 'from'),
        contractOf('Member', derivedIndex, 'to', { UserProfile: plainTable() }),
        { table: 'userProfile', to: 'UserProfile' },
        { table: 'UserProfile', to: 'Member' },
      ).operations,
    );

    expect(ops.map((op) => op.label)).toEqual([
      'Rename table userProfile to UserProfile',
      'Rename table UserProfile to Member',
      `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on Member`,
      `Create index Member_handle_idx_${HANDLE_INDEX_HASH} on Member`,
    ]);
  });

  it('refuses a table an earlier rename in the migration took away', () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          RENAME,
          RENAME,
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining(
          'table "userProfile" does not exist at this point of the migration',
        ),
      }),
    );
  });

  it('reads the same operations again through Migration.readOperations', async () => {
    const migration = renameMigration(
      contractOf('userProfile', derivedIndex, 'from'),
      contractOf('UserProfile', derivedIndex, 'to'),
      RENAME,
    );
    const first = await Promise.all(Migration.readOperations(migration));
    const second = await Promise.all(Migration.readOperations(migration));

    expect(second).toEqual(first);
  });

  it('refuses a second direct read of the operations, since the table is already renamed', () => {
    const migration = renameMigration(
      contractOf('userProfile', {}, 'from'),
      contractOf('UserProfile', {}, 'to'),
      RENAME,
    );
    void migration.operations;

    expect(() => migration.operations).toThrow(
      expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_UNMATCHED' }),
    );
  });
});
