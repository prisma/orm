import { canonicalizeContractToObject, computeStorageHash } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { createSnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { normalizeSqlStorage } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';

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

describe('PostgresContractSerializer normal form of storage', () => {
  const serializer = new PostgresContractSerializer();

  it("is the SQL family's, and snapshots are verified by their content", () => {
    expect({
      normalizeStorage: serializer.normalizeStorage,
      skipsSnapshotContentVerification: serializer.skipsSnapshotContentVerification,
    }).toEqual({
      normalizeStorage: normalizeSqlStorage,
      skipsSnapshotContentVerification: undefined,
    });
  });

  it("covers a restrictive policy's permissive: false in the hash", () => {
    const hashOf = (storage: unknown) =>
      computeStorageHash({
        target: 'postgres',
        targetFamily: 'sql',
        storage: blindCast<Record<string, unknown>, 'test storage literal'>(storage),
        normalizeStorage: normalizeSqlStorage,
      });
    const permissive = structuredClone(STORAGE_WITH_RESTRICTIVE_POLICY);
    const { permissive: _off, ...policyWithoutFlag } =
      permissive.namespaces.public.entries.policy.tenant_isolation;
    expect(hashOf(STORAGE_WITH_RESTRICTIVE_POLICY)).not.toBe(
      hashOf({
        namespaces: {
          public: {
            entries: {
              ...permissive.namespaces.public.entries,
              policy: { tenant_isolation: policyWithoutFlag },
            },
          },
        },
      }),
    );
  });

  it('snapshot verification recomputes the emit-time hash for a restrictive-policy contract', () => {
    const emitHash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: STORAGE_WITH_RESTRICTIVE_POLICY,
      normalizeStorage: normalizeSqlStorage,
    });
    const contractJson = {
      storage: { ...STORAGE_WITH_RESTRICTIVE_POLICY, storageHash: emitHash },
      target: 'postgres',
      targetFamily: 'sql',
    };

    const verifier = createSnapshotContentVerifier(serializer.normalizeStorage);

    expect(() =>
      verifier.assertSnapshotContentMatches(contractJson, emitHash, '/store/contract.json'),
    ).not.toThrow();
  });

  it('the written storage section hashes to the hash of the storage it was written from', () => {
    const storage = {
      namespaces: {
        public: {
          id: 'public',
          entries: {
            policy: {
              tenant_isolation: {
                kind: 'policy',
                name: 'tenant_isolation',
                tableName: 'orders',
                namespaceId: 'public',
                operation: 'select',
                roles: [],
                using: 'true',
                permissive: false,
              },
            },
            table: {
              orders: {
                columns: {
                  id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false, many: false },
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
    const hash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage,
      normalizeStorage: normalizeSqlStorage,
    });
    const contract = serializer.deserializeContract({
      formatVersion: 1,
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: 'p',
      roots: {},
      domain: { namespaces: {} },
      storage: { ...storage, storageHash: hash },
      extensions: {},
      capabilities: {},
      meta: {},
    });
    const written = blindCast<{ storageHash: string } & Record<string, unknown>, 'storage'>(
      canonicalizeContractToObject(contract, {
        serializeContract: (c) =>
          serializer.serializeContract(blindCast<Contract<SqlStorage>, 'postgres contract'>(c)),
        normalizeStorage: serializer.normalizeStorage,
      })['storage'],
    );
    const { storageHash: _stored, ...writtenStorage } = written;
    expect(
      computeStorageHash({
        target: 'postgres',
        targetFamily: 'sql',
        storage: writtenStorage,
        normalizeStorage: normalizeSqlStorage,
      }),
    ).toBe(hash);
  });
});
