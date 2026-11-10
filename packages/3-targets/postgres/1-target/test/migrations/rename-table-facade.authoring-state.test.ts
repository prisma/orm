import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { buildMigrationArtifacts } from '@internal/migration-tools/migration';
import type { IndexInput, SqlStorage } from '@internal/sql-contract/types';
import { computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractOf, type ProfileSpec, stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

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

const HANDLE_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });
const OLD_INDEX = `userProfile_handle_idx_${HANDLE_HASH}`;

const withHandleIndex: ProfileSpec = {
  indexes: (tableName): readonly IndexInput[] => [
    {
      columns: ['handle'],
      naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash: HANDLE_HASH },
      where: undefined,
      unique: false,
      type: undefined,
      options: undefined,
    },
  ],
};

function migrationOf(
  operations: (migration: {
    renameIndex: (options: {
      schema: string;
      table: string;
      from: string;
      to: string;
    }) => Promise<Op>;
    renameTable: (options: { table: string; to: string }) => readonly Promise<Op>[];
  }) => readonly Promise<Op>[],
): PostgresMigration & { readonly operations: readonly Promise<Op>[] } {
  const startJson = jsonOf(contractOf('userProfile', withHandleIndex, 'from'));
  const endJson = jsonOf(contractOf('UserProfile', withHandleIndex, 'to'));
  class HandWritten extends PostgresMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return operations({
        renameIndex: (options) => this.renameIndex(options),
        renameTable: (options) => this.renameTable(options),
      });
    }
  }
  return new HandWritten(stack);
}

describe('PostgresMigration authoring state', () => {
  it('renames the index from the name an earlier renameIndex gave it', async () => {
    const ops = await Promise.all(
      migrationOf((m) => [
        m.renameIndex({
          schema: 'public',
          table: 'userProfile',
          from: OLD_INDEX,
          to: 'custom_handle',
        }),
        ...m.renameTable({ table: 'userProfile', to: 'UserProfile' }),
      ]).operations,
    );

    expect(ops.map((op) => op.label)).toEqual([
      `Rename index "${OLD_INDEX}" to "custom_handle" on "userProfile"`,
      'Rename table "userProfile" to "UserProfile"',
      `Rename index "custom_handle" to "UserProfile_handle_idx_${HANDLE_HASH}" on "UserProfile"`,
    ]);
  });

  it('builds the artifacts again and reads providedInvariants, each from the start contract', async () => {
    const migration = migrationOf((m) => [
      ...m.renameTable({ table: 'userProfile', to: 'UserProfile' }),
    ]);

    const first = await buildMigrationArtifacts(migration, null);
    expect(migration.providedInvariants).toEqual([]);
    expect(migration.providedInvariants).toEqual([]);
    const second = await buildMigrationArtifacts(migration, null);

    expect(second.opsJson).toBe(first.opsJson);
    expect((JSON.parse(first.opsJson) as readonly Op[]).map((op) => op.label)).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      `Rename index "${OLD_INDEX}" to "UserProfile_handle_idx_${HANDLE_HASH}" on "UserProfile"`,
    ]);
  });

  it('renames an index without reading the start contract when the migration renames no table', async () => {
    const endJson = jsonOf(contractOf('userProfile', withHandleIndex, 'to'));
    class IndexOnly extends PostgresMigration {
      override readonly startContractJson = { storage: { storageHash: 'not-a-full-contract' } };
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
        return [
          this.renameIndex({
            schema: 'public',
            table: 'userProfile',
            from: OLD_INDEX,
            to: 'custom_handle',
          }),
        ];
      }
    }
    const ops = await Promise.all(new IndexOnly(stack).operations);

    expect(ops.map((op) => op.label)).toEqual([
      `Rename index "${OLD_INDEX}" to "custom_handle" on "userProfile"`,
    ]);
  });
});
