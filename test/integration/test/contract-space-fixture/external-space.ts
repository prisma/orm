/**
 * All-external variant of the synthetic test extension: a contract space
 * that pins a head ref but ships NO migration packages, mirroring
 * `@internal/extension-supabase` (its `auth`/`storage` tables are
 * `external`, so the space emits no DDL and has nothing to author).
 * Exercises the declarative marker advancement path in `migrate`.
 */

import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { ContractSpace } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

export const TEST_EXTERNAL_SPACE_ID = 'test-external-space';

const storageBody = {
  namespaces: {
    ext_platform: {
      id: 'ext_platform',
      entries: {
        table: {
          platform_users: {
            columns: {
              id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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

export const TEST_EXTERNAL_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
  ...sqlContractCanonicalizationHooks,
});

const testExternalSpaceContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  // The property the declarative marker advance keys on: every element in
  // this space resolves to the `external` control policy.
  defaultControlPolicy: 'external',
  roots: {},
  domain: {
    namespaces: {
      ext_platform: {
        models: {},
      },
    },
  },
  capabilities: {},
  extensions: {},
  meta: {},
  profileHash: profileHash('synthetic-test-external-space-profile-v1'),
  storage: new SqlStorage({
    storageHash: coreHash(TEST_EXTERNAL_HEAD_HASH),
    namespaces: {
      ext_platform: postgresCreateNamespace(storageBody.namespaces.ext_platform),
    },
  }),
};

const testExternalSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: testExternalSpaceContract,
  migrations: [],
  headRef: { hash: TEST_EXTERNAL_HEAD_HASH, invariants: [] },
};

const testExternalSpaceExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: TEST_EXTERNAL_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: testExternalSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { testExternalSpaceExtensionDescriptor };
export default testExternalSpaceExtensionDescriptor;
