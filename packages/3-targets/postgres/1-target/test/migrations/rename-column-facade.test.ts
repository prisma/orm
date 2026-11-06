/**
 * `this.renameColumn` in a hand-written Postgres migration: the column rename, then a rename of
 * each unique constraint, foreign key and index on the column whose name derives from the column
 * name, computed against the schema the migration's earlier renames leave.
 */

import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { buildMigrationArtifacts } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { ORIGINAL_COLUMNS, profileContract } from './rename-column-fixtures';
import { stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };
type Rename =
  | { readonly kind: 'table'; readonly table: string; readonly to: string }
  | {
      readonly kind: 'column';
      readonly table: string;
      readonly column: string;
      readonly to: string;
    };

const stack = {
  adapter: {
    ...postgresTypeComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

function renameMigration(
  start: Contract<SqlStorage>,
  end: Contract<SqlStorage>,
  renames: readonly Rename[],
): PostgresMigration & { readonly operations: readonly Promise<Op>[] } {
  const startJson = jsonOf(start);
  const endJson = jsonOf(end);
  class Renames extends PostgresMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return renames.flatMap(({ kind, ...options }) =>
        kind === 'table'
          ? this.renameTable({ table: options.table, to: options.to })
          : this.renameColumn({
              table: options.table,
              column: 'column' in options ? options.column : '',
              to: options.to,
            }),
      );
    }
  }
  return new Renames(stack);
}

async function labelsOf(
  start: Contract<SqlStorage>,
  end: Contract<SqlStorage>,
  renames: readonly Rename[],
): Promise<readonly string[]> {
  const ops = await Promise.all(renameMigration(start, end, renames).operations);
  return ops.map((op) => op.label);
}

const EMAIL_RENAMED = { ...ORIGINAL_COLUMNS, email: 'emailAddress' };
const renameEmail: Rename = {
  kind: 'column',
  table: 'Profile',
  column: 'email',
  to: 'emailAddress',
};

describe('PostgresMigration.renameColumn', () => {
  it('emits the column rename, then a rename of each object named after the old column', async () => {
    const objects = { emailUnique: {}, emailIndex: true };
    const labels = await labelsOf(
      profileContract('from', { objects }),
      profileContract('to', { columns: EMAIL_RENAMED, objects }),
      [renameEmail],
    );
    expect(labels.slice(0, 2)).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "Profile_emailAddress_key" on "Profile"',
    ]);
    expect(labels[2]).toMatch(/^Rename index "Profile_email_idx_.*" to "Profile_emailAddress_idx_/);
    expect(labels).toHaveLength(3);
  });

  it('renders the rename statement', async () => {
    const ops: readonly Op[] = await Promise.all(
      renameMigration(profileContract('from'), profileContract('to', { columns: EMAIL_RENAMED }), [
        renameEmail,
      ]).operations,
    );
    expect(ops.map((op) => op.execute.map((step) => step.sql))).toEqual([
      ['ALTER TABLE "Profile" RENAME COLUMN "email" TO "emailAddress"'],
    ]);
  });

  it('renames a column of a table an earlier renameTable renamed, on its new name', async () => {
    const objects = { emailUnique: {} };
    expect(
      await labelsOf(
        profileContract('from', { objects }),
        profileContract('to', { table: 'User', columns: EMAIL_RENAMED, objects }),
        [
          { kind: 'table', table: 'Profile', to: 'User' },
          { kind: 'column', table: 'User', column: 'email', to: 'emailAddress' },
        ],
      ),
    ).toEqual([
      'Rename table "Profile" to "User"',
      'Rename primary key "Profile_pkey" to "User_pkey" on "User"',
      'Rename column "User"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "User_emailAddress_key" on "User"',
    ]);
  });

  it('builds the artifacts again with the same operations', async () => {
    const migration = renameMigration(
      profileContract('from', { objects: { emailUnique: {} } }),
      profileContract('to', { columns: EMAIL_RENAMED, objects: { emailUnique: {} } }),
      [renameEmail],
    );
    const first = await buildMigrationArtifacts(migration, null);
    const second = await buildMigrationArtifacts(migration, null);
    expect(second.opsJson).toBe(first.opsJson);
    expect((JSON.parse(first.opsJson) as readonly Op[]).map((op) => op.label)).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "Profile_emailAddress_key" on "Profile"',
    ]);
  });

  it('refuses a column the table does not have at that point of the migration', () => {
    const migration = renameMigration(
      profileContract('from'),
      profileContract('to', { columns: EMAIL_RENAMED }),
      [{ kind: 'column', table: 'Profile', column: 'nickname', to: 'emailAddress' }],
    );
    expect(() => migration.operations).toThrow(
      expect.objectContaining({ code: 'MIGRATION.COLUMN_RENAME_UNMATCHED' }),
    );
  });
});
