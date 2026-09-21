import { computeStorageHash } from '@internal/contract/hashing';
import { createSnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';

/**
 * A storage subtree whose canonical form differs between the emit-time
 * family hooks and the serializer's on-disk preserve set: a RESTRICTIVE
 * policy's required `permissive: false` is canonicalized away by the family
 * hooks (so it is absent from the published hash's input) but preserved on
 * disk by the serializer so the contract re-deserializes.
 */
const STORAGE_WITH_RESTRICTIVE_POLICY = {
  namespaces: {
    public: {
      entries: {
        policy: {
          tenant_isolation: { permissive: false, table: 'orders', using: 'true' },
        },
        table: { orders: { columns: { id: {} } } },
      },
    },
  },
};

describe('PostgresContractSerializer hash canonicalization hooks', () => {
  const serializer = new PostgresContractSerializer();

  it('publishes the family emit hooks as hashCanonicalizationHooks', () => {
    expect(serializer.hashCanonicalizationHooks).toBe(sqlContractCanonicalizationHooks);
  });

  it('snapshot verification recomputes the emit-time hash for a restrictive-policy contract', () => {
    const emitHash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: STORAGE_WITH_RESTRICTIVE_POLICY,
      ...sqlContractCanonicalizationHooks,
    });
    const contractJson = {
      storage: { ...STORAGE_WITH_RESTRICTIVE_POLICY, storageHash: emitHash },
      target: 'postgres',
      targetFamily: 'sql',
    };

    const verifier = createSnapshotContentVerifier(serializer.hashCanonicalizationHooks);

    expect(() =>
      verifier.assertSnapshotContentMatches(contractJson, emitHash, '/store/contract.json'),
    ).not.toThrow();
  });

  it('the serialization-preserve hooks would NOT reproduce the emit-time hash', () => {
    const emitHash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: STORAGE_WITH_RESTRICTIVE_POLICY,
      ...sqlContractCanonicalizationHooks,
    });
    const serializationHash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: STORAGE_WITH_RESTRICTIVE_POLICY,
      shouldPreserveEmpty: serializer.shouldPreserveEmpty,
      sortStorage: serializer.sortStorage,
    });

    expect(serializationHash).not.toBe(emitHash);
  });
});
