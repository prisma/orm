import { computeStorageHash } from '@internal/contract/hashing';
import { coreHash, profileHash } from '@internal/contract/types';
import type { MongoContract } from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { MONGO_TEST_COLLECTION } from './constants';

const TARGET = 'mongo' as const;
const TARGET_FAMILY = 'mongo' as const;

const storageBody = {
  namespaces: {
    __unbound__: {
      id: '__unbound__' as const,
      kind: 'mongo-namespace' as const,
      entries: {
        collection: {
          [MONGO_TEST_COLLECTION]: {
            kind: 'mongo-collection' as const,
            indexes: [
              {
                kind: 'mongo-index' as const,
                name: 'tenantId_1',
                keys: [{ field: 'tenantId', direction: 1 as const }],
                unique: true,
              },
            ],
            validator: {
              kind: 'mongo-validator' as const,
              jsonSchema: {
                bsonType: 'object',
                required: ['tenantId', 'event'],
                properties: {
                  tenantId: { bsonType: 'string' },
                  event: { bsonType: 'string' },
                },
              },
              validationLevel: 'strict' as const,
              validationAction: 'error' as const,
            },
          },
        },
      },
    },
  },
};

/**
 * Content-addressed hash of the synthetic Mongo test extension's
 * storage IR. Computed via the same `computeStorageHash` the
 * production emit pipeline uses, so the descriptor self-consistency
 * check and the runner's marker writes see the same value the
 * framework would compute for any real Mongo extension.
 */
export const MONGO_TEST_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
  ...mongoContractCanonicalizationHooks,
});

/**
 * The contract value the synthetic Mongo test extension publishes
 * through its descriptor. Declares a single `test_audit_event`
 * collection with one unique index and one strict JSON-schema
 * validator — the smallest non-empty Mongo schema that exercises both
 * the index and validator surfaces of `MongoStorageCollection` (see
 * `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts`).
 *
 * Companion to the SQL fixture's `testContractSpaceContract`; the two
 * coexist under `test/integration/test/` so the contract-space
 * mechanism can be exercised end-to-end against either family without
 * pulling in the baggage (real codecs, native extension installs) of
 * production extensions like `cipherstash` or `pgvector`.
 */
export const mongoTestContractSpaceContract: MongoContract = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  domain: {
    namespaces: {
      __unbound__: {
        models: {},
      },
    },
  },
  capabilities: {},
  extensions: {},
  meta: {},
  profileHash: profileHash('synthetic-mongo-test-contract-space-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(MONGO_TEST_HEAD_HASH),
  },
};
