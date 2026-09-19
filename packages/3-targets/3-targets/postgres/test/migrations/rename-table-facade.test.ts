/**
 * `this.renameTable` in a hand-written Postgres migration. It reads the migration's start and end contracts and emits the table rename, then a rename of each object on the table whose name the planner derived from the old table name: unnamed primary keys, unique constraints and foreign keys, and wire-named indexes and checks. Only objects the end contract leaves otherwise unchanged are renamed; a constraint the end contract also changes keeps its name. Explicitly named objects keep their names. A table missing from either contract is refused.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import {
  type CheckConstraintInput,
  type ForeignKeyInput,
  type IndexInput,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import {
  contractOf,
  NICKNAME_CHECK,
  type ProfileSpec,
  postTable,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

function renameMigration(
  start: Contract<SqlStorage> | null,
  end: Contract<SqlStorage>,
  rename: { readonly schema?: string; readonly table: string; readonly to: string },
): { readonly operations: readonly Promise<Op>[] } {
  const endJson = jsonOf(end);
  class WithoutStart extends PostgresMigration {
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

async function renameOps(
  start: Contract<SqlStorage> | null,
  end: Contract<SqlStorage>,
  rename: { readonly schema?: string; readonly table: string; readonly to: string } = RENAME,
): Promise<readonly Op[]> {
  return Promise.all(renameMigration(start, end, rename).operations);
}

async function renameLabels(spec: ProfileSpec, nextSpec: ProfileSpec = spec) {
  const ops = await renameOps(
    contractOf('userProfile', spec, 'from'),
    contractOf('UserProfile', nextSpec, 'to'),
  );
  return ops.map((op) => op.label);
}

const HANDLE_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });
const NICKNAME_HASH = computeCheckContentHash(NICKNAME_CHECK);

const handleIndex = (tableName: string): IndexInput => ({
  columns: ['handle'],
  naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash: HANDLE_HASH },
  where: undefined,
  unique: false,
  type: undefined,
  options: undefined,
});

const nicknameCheck = (tableName: string): CheckConstraintInput => ({
  naming: { kind: 'wire', prefix: `${tableName}_nickname_check`, hash: NICKNAME_HASH },
  expression: NICKNAME_CHECK,
});

const accountForeignKey = (tableName: string): ForeignKeyInput => ({
  source: reference(tableName, ['accountId']),
  target: reference('account', ['id']),
});

const withObjects: ProfileSpec = {
  primaryKey: { columns: ['id'] },
  uniques: [{ columns: ['email'] }],
  foreignKeys: (tableName) => [accountForeignKey(tableName)],
  indexes: (tableName) => [handleIndex(tableName)],
  checks: (tableName) => [nicknameCheck(tableName)],
};

function rlsContract(tableName: string, hashSeed: string): Contract<SqlStorage> {
  const policy = new PostgresRlsPolicy({
    naming: { kind: 'wire', prefix: 'tenant_read', hash: 'f8d5e783' },
    tableName,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: '(tenant_id = 1)',
    withCheck: undefined,
    permissive: true,
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: {
              [tableName]: new StorageTable({
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  tenant_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'], name: 'profile_pk' },
                foreignKeys: [],
                uniques: [],
                indexes: [],
              }),
            },
            policy: { [policy.name]: policy },
            rls: { [tableName]: new PostgresRlsEnablement({ tableName, namespaceId: 'public' }) },
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

describe('PostgresMigration.renameTable', () => {
  it('emits the table rename, then a rename of each object named after the old table', async () => {
    expect(await renameLabels(withObjects)).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
      'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
      'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
      `Rename index "userProfile_handle_idx_${HANDLE_HASH}" to "UserProfile_handle_idx_${HANDLE_HASH}" on "UserProfile"`,
      `Rename check constraint "userProfile_nickname_check_${NICKNAME_HASH}" to "UserProfile_nickname_check_${NICKNAME_HASH}" on "UserProfile"`,
    ]);
  });

  it('renders the rename statements', async () => {
    const ops = await renameOps(
      contractOf('userProfile', { primaryKey: { columns: ['id'] } }, 'from'),
      contractOf('UserProfile', { primaryKey: { columns: ['id'] } }, 'to'),
    );

    expect(ops.map((op) => op.execute.map((step) => step.sql))).toEqual([
      ['ALTER TABLE "userProfile" RENAME TO "UserProfile"'],
      ['ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_pkey" TO "UserProfile_pkey"'],
    ]);
  });

  it('renames an unnamed constraint to the explicit name the end contract gives it', async () => {
    expect(
      await renameLabels(
        { uniques: [{ columns: ['email'] }] },
        { uniques: [{ columns: ['email'], name: 'profile_email_unique' }] },
      ),
    ).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      'Rename unique constraint "userProfile_email_key" to "profile_email_unique" on "UserProfile"',
    ]);
  });

  it('leaves a foreign key the end contract points at another table under its current name', async () => {
    const memberTable = () => ({
      member: new StorageTable({
        columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
        primaryKey: { columns: ['id'], name: 'member_pk' },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      }),
    });
    const ops = await renameOps(
      contractOf(
        'userProfile',
        { foreignKeys: (tableName) => [accountForeignKey(tableName)] },
        'from',
        memberTable,
      ),
      contractOf(
        'UserProfile',
        {
          foreignKeys: (tableName) => [
            {
              source: reference(tableName, ['accountId']),
              target: reference('member', ['id']),
              name: 'profile_member_fk',
            },
          ],
        },
        'to',
        memberTable,
      ),
    );

    expect(ops.map((op) => op.label)).toEqual(['Rename table "userProfile" to "UserProfile"']);
  });

  it('leaves a primary key whose columns the end contract changes under its current name', async () => {
    expect(
      await renameLabels(
        { primaryKey: { columns: ['id'] } },
        { primaryKey: { columns: ['id', 'email'], name: 'profile_pk' } },
      ),
    ).toEqual(['Rename table "userProfile" to "UserProfile"']);
  });

  it('leaves explicitly named objects alone', async () => {
    const spec: ProfileSpec = {
      primaryKey: { columns: ['id'], name: 'profile_pk' },
      uniques: [{ columns: ['email'], name: 'profile_email_unique' }],
      foreignKeys: (tableName) => [{ ...accountForeignKey(tableName), name: 'profile_account_fk' }],
      indexes: (tableName) => [
        { ...handleIndex(tableName), naming: { kind: 'exact', name: 'profile_handle' } },
      ],
    };

    expect(await renameLabels(spec)).toEqual(['Rename table "userProfile" to "UserProfile"']);
  });

  it('leaves a foreign key on another table that references the renamed table alone', async () => {
    const ops = await renameOps(
      contractOf('userProfile', {}, 'from', (tableName) => ({ post: postTable(tableName) })),
      contractOf('UserProfile', {}, 'to', (tableName) => ({ post: postTable(tableName) })),
    );

    expect(ops.map((op) => op.label)).toEqual(['Rename table "userProfile" to "UserProfile"']);
  });

  it('emits the rename alone for a table with row-level security and a policy, which the rename carries', async () => {
    const ops = await renameOps(
      rlsContract('userProfile', 'from'),
      rlsContract('UserProfile', 'to'),
    );

    expect(ops.map((op) => op.id)).toEqual(['renameTable.userProfile']);
  });

  it('renames in the schema that declares the table', async () => {
    const ops = await renameOps(
      contractOf('userProfile', {}, 'from', () => ({}), 'auth'),
      contractOf('UserProfile', {}, 'to', () => ({}), 'auth'),
      { schema: 'auth', ...RENAME },
    );

    expect(ops.map((op) => op.execute.map((step) => step.sql))).toEqual([
      ['ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"'],
    ]);
  });

  it('refuses a table the start contract does not have', async () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          { table: 'ghost', to: 'UserProfile' },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining('table "ghost" does not exist in the start contract'),
      }),
    );
  });

  it('refuses a new name the end contract does not have', async () => {
    expect(
      () =>
        renameMigration(
          contractOf('userProfile', {}, 'from'),
          contractOf('UserProfile', {}, 'to'),
          { table: 'userProfile', to: 'Profile' },
        ).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining('table "Profile" does not exist in the end contract'),
      }),
    );
  });

  it('refuses a new name the start contract already has', async () => {
    const withBoth = contractOf('userProfile', {}, 'from', () => ({
      UserProfile: new StorageTable({
        columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
        primaryKey: { columns: ['id'], name: 'other_pk' },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      }),
    }));
    expect(
      () => renameMigration(withBoth, contractOf('UserProfile', {}, 'to'), RENAME).operations,
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining(
          'table "UserProfile" already exists in the start contract',
        ),
      }),
    );
  });

  it('refuses in a migration without a start contract', async () => {
    expect(
      () => renameMigration(null, contractOf('UserProfile', {}, 'to'), RENAME).operations,
    ).toThrow(expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_UNMATCHED' }));
  });
});
