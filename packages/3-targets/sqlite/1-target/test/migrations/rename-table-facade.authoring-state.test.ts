import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { buildMigrationArtifacts } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import { sqliteTestComponents } from '../sqlite-test-types';
import { contractOf, HANDLE_INDEX_HASH, handleIndex, stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: {
    ...sqliteTestComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new SqliteContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

describe('SqliteMigration authoring state', () => {
  it('builds the artifacts again and reads providedInvariants, each from the start contract', async () => {
    const spec = { indexes: (tableName: string) => [handleIndex(tableName)] };
    const startJson = jsonOf(contractOf('userProfile', spec, 'from'));
    const endJson = jsonOf(contractOf('UserProfile', spec, 'to'));
    class HandWritten extends SqliteMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
        return [...this.renameTable({ table: 'userProfile', to: 'UserProfile' })];
      }
    }
    const migration = new HandWritten(stack);

    const first = await buildMigrationArtifacts(migration, null);
    expect(migration.providedInvariants).toEqual([]);
    expect(migration.providedInvariants).toEqual([]);
    const second = await buildMigrationArtifacts(migration, null);

    expect(second.opsJson).toBe(first.opsJson);
    expect((JSON.parse(first.opsJson) as readonly Op[]).map((op) => op.label)).toEqual([
      'Rename table userProfile to UserProfile',
      `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
    ]);
  });
});
