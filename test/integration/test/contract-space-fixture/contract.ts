import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { TEST_BOX_TABLE } from './constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const storageBody = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          [TEST_BOX_TABLE]: {
            columns: {
              x: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
              y: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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

/**
 * Content-addressed hash of the synthetic test extension's storage IR.
 * Computed via the same `computeStorageHash` the production emit pipeline
 * uses, so the descriptor self-consistency check and the runner's marker
 * writes see the same value the framework would compute for any real
 * extension.
 */
export const TEST_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
  ...sqlContractCanonicalizationHooks,
});

/**
 * The contract value the synthetic test extension publishes through its
 * descriptor. Declares a single `test_box` table with two integer columns
 * — the simplest non-empty schema representable in today's SQL contract
 * IR. Future IR work (composite types, enums, domains) can swap this for
 * a richer fixture without changing the descriptor wiring.
 */
export const testContractSpaceContract: Contract<SqlStorage> = {
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
  profileHash: profileHash('synthetic-test-contract-space-profile-v1'),
  storage: new SqlStorage({
    storageHash: coreHash(TEST_HEAD_HASH),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace(storageBody.namespaces[UNBOUND_NAMESPACE_ID]),
    },
  }),
};
