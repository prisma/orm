/**
 * SQLite variant of the synthetic test extension: a contract space that claims one `test_box` table on SQLite, with one baseline migration. Used by the `db sign` journeys that sign an app space and an extension space together on SQLite.
 */

import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { ContractSpace, MigrationPackage } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { TEST_BASELINE_INVARIANT_ID, TEST_BOX_TABLE, TEST_SPACE_ID } from './constants';

const TARGET = 'sqlite' as const;
const TARGET_FAMILY = 'sql' as const;

const storageBody = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          [TEST_BOX_TABLE]: {
            columns: {
              x: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false },
              y: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    },
  },
};

export const TEST_SQLITE_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
  ...sqlContractCanonicalizationHooks,
});

const testSqliteSpaceContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  domain: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        models: {},
      },
    },
  },
  capabilities: {},
  extensions: {},
  meta: {},
  profileHash: profileHash('synthetic-test-sqlite-space-profile-v1'),
  storage: new SqlStorage({
    storageHash: coreHash(TEST_SQLITE_HEAD_HASH),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace(storageBody.namespaces[UNBOUND_NAMESPACE_ID]),
    },
  }),
};

const baselineMigration: MigrationPackage = {
  dirName: '20260101T0000_create_test_box',
  metadata: {
    migrationHash: 'synthetic-test-sqlite-space-baseline-hash-v1',
    from: null,
    to: TEST_SQLITE_HEAD_HASH,
    providedInvariants: [TEST_BASELINE_INVARIANT_ID],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  ops: [
    {
      id: `${TEST_BOX_TABLE}.create`,
      label: `Create table "${TEST_BOX_TABLE}"`,
      operationClass: 'additive',
      invariantId: TEST_BASELINE_INVARIANT_ID,
    },
  ],
};

const testSqliteSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: testSqliteSpaceContract,
  migrations: [baselineMigration],
  headRef: { hash: TEST_SQLITE_HEAD_HASH, invariants: [TEST_BASELINE_INVARIANT_ID] },
};

const testSqliteSpaceExtensionDescriptor: SqlControlExtensionDescriptor<'sqlite'> = {
  kind: 'extension' as const,
  id: TEST_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'sqlite' as const,
  version: '0.0.1',
  contractSpace: testSqliteSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
  }),
};

export default testSqliteSpaceExtensionDescriptor;
