import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { NormalizeStorage } from '../src/canonicalization';
import {
  assertContractHashes,
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '../src/hashing';

const sha256OfJsonText = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(value, null, 2))
    .digest('hex');

const sqlSortStorage: NormalizeStorage = (storage) => storage;

const SQL_HOOKS = { normalizeStorage: sqlSortStorage };

const emptyNamespacedStorage = () => ({
  namespaces: {
    __unbound__: { id: '__unbound__' as const, entries: { table: {} } },
  },
});

describe('computeStorageHash', () => {
  it('returns a bare hex string', () => {
    const hash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: emptyNamespacedStorage(),
      ...SQL_HOOKS,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces stable hashes for identical input', () => {
    const args = {
      target: 'postgres',
      targetFamily: 'sql',
      storage: emptyNamespacedStorage(),
      ...SQL_HOOKS,
    };
    expect(computeStorageHash(args)).toBe(computeStorageHash(args));
  });

  it('produces different hashes for different storage', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeStorageHash({ ...base, storage: emptyNamespacedStorage(), ...SQL_HOOKS });
    const hash2 = computeStorageHash({
      ...base,
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } },
                },
              },
            },
          },
        },
      },
      ...SQL_HOOKS,
    });
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different targets', () => {
    const storage = emptyNamespacedStorage();
    const hash1 = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage,
      ...SQL_HOOKS,
    });
    const hash2 = computeStorageHash({
      target: 'mysql',
      targetFamily: 'sql',
      storage,
      ...SQL_HOOKS,
    });
    expect(hash1).not.toBe(hash2);
  });

  it('ignores key ordering in storage', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeStorageHash({
      ...base,
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: {
              table: {
                a: { columns: { x: { codecId: 'pg/text@1', dataType: 'pg/text' } } },
                b: { columns: { y: { codecId: 'pg/text@1', dataType: 'pg/text' } } },
              },
            },
          },
        },
      },
      ...SQL_HOOKS,
    });
    const hash2 = computeStorageHash({
      ...base,
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: {
              table: {
                b: { columns: { y: { codecId: 'pg/text@1', dataType: 'pg/text' } } },
                a: { columns: { x: { codecId: 'pg/text@1', dataType: 'pg/text' } } },
              },
            },
          },
        },
      },
      ...SQL_HOOKS,
    });
    expect(hash1).toBe(hash2);
  });

  it('ignores namespace kind discriminators in storage', () => {
    const tables = {
      test_box: {
        columns: {
          x: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    };
    const withoutKind = {
      namespaces: {
        public: { id: 'public', entries: { table: tables } },
      },
    };
    const withKind = {
      namespaces: {
        public: { id: 'public', kind: 'postgres-schema', entries: { table: tables } },
      },
    };
    const base = { target: 'postgres', targetFamily: 'sql', ...SQL_HOOKS };
    expect(computeStorageHash({ ...base, storage: withoutKind })).toBe(
      computeStorageHash({ ...base, storage: withKind }),
    );
  });
});

describe('computeProfileHash', () => {
  it('returns a bare hex string', () => {
    const hash = computeProfileHash({
      target: 'postgres',
      targetFamily: 'sql',
      capabilities: { postgres: { jsonAgg: true } },
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different capabilities', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeProfileHash({ ...base, capabilities: {} });
    const hash2 = computeProfileHash({
      ...base,
      capabilities: { postgres: { jsonAgg: true } },
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('computeExecutionHash', () => {
  it('returns a bare hex string', () => {
    const hash = computeExecutionHash({
      target: 'postgres',
      targetFamily: 'sql',
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', entry: 'user', field: 'created_at' },
              onCreate: { kind: 'generator', id: 'now' },
            },
          ],
        },
      },
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different execution sections', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeExecutionHash({
      ...base,
      execution: { mutations: { defaults: [] } },
    });
    const hash2 = computeExecutionHash({
      ...base,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', entry: 'user', field: 'id' },
              onCreate: { kind: 'generator', id: 'uuid' },
            },
          ],
        },
      },
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('values the hashes keep', () => {
  it('gives generator params that differ only in a false value different execution hashes', () => {
    const executionWith = (params: Record<string, unknown>) =>
      computeExecutionHash({
        target: 'postgres',
        targetFamily: 'sql',
        execution: {
          mutations: {
            defaults: [
              {
                ref: { table: 'user', column: 'id' },
                onCreate: { kind: 'generator', id: 'nanoid', params },
              },
            ],
          },
        },
      });
    expect(executionWith({ size: 21, upper: false })).not.toBe(executionWith({ size: 21 }));
  });

  it('gives storage that differs only in a false, empty array or empty object different hashes', () => {
    const storageWith = (column: Record<string, unknown>) =>
      computeStorageHash({
        target: 'postgres',
        targetFamily: 'sql',
        storage: {
          namespaces: {
            public: { id: 'public', entries: { table: { t: { columns: { c: column } } } } },
          },
        },
        normalizeStorage: (storage) => storage,
      });
    const base = { codecId: 'pg/text@1', nullable: false };
    expect(
      new Set([
        storageWith(base),
        storageWith({ ...base, flag: false }),
        storageWith({ ...base, list: [] }),
        storageWith({ ...base, map: {} }),
      ]).size,
    ).toBe(4);
  });
});

describe('the hash input', () => {
  it('is the family, the target and the storage, with keys sorted', () => {
    expect(
      computeStorageHash({
        target: 'postgres',
        targetFamily: 'sql',
        storage: emptyNamespacedStorage(),
        ...SQL_HOOKS,
      }),
    ).toBe(
      sha256OfJsonText({
        storage: { namespaces: { __unbound__: { entries: { table: {} }, id: '__unbound__' } } },
        target: 'postgres',
        targetFamily: 'sql',
      }),
    );
  });

  it('is the family, the target and the capabilities for the profile hash', () => {
    expect(
      computeProfileHash({
        target: 'postgres',
        targetFamily: 'sql',
        capabilities: { postgres: { lateral: false, jsonAgg: true }, sql: {} },
      }),
    ).toBe(
      sha256OfJsonText({
        capabilities: { postgres: { jsonAgg: true, lateral: false }, sql: {} },
        target: 'postgres',
        targetFamily: 'sql',
      }),
    );
  });

  it('is the family, the target and the execution section for the execution hash', () => {
    expect(
      computeExecutionHash({
        target: 'postgres',
        targetFamily: 'sql',
        execution: {
          mutations: {
            defaults: [
              {
                ref: { namespace: 'public', entry: 'user', field: 'created_at' },
                onCreate: { kind: 'generator', id: 'now' },
              },
            ],
          },
        },
      }),
    ).toBe(
      sha256OfJsonText({
        execution: {
          mutations: {
            defaults: [
              {
                onCreate: { id: 'now', kind: 'generator' },
                ref: { entry: 'user', field: 'created_at', namespace: 'public' },
              },
            ],
          },
        },
        target: 'postgres',
        targetFamily: 'sql',
      }),
    );
  });
});

describe('assertContractHashes', () => {
  const savedContract = {
    target: 'postgres',
    targetFamily: 'sql',
    storage: { storageHash: 'stale', ...emptyNamespacedStorage() },
    capabilities: { postgres: { jsonAgg: true } },
    execution: {
      executionHash: 'stale',
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', entry: 'user', field: 'created_at' },
            onCreate: { kind: 'generator', id: 'now' },
          },
        ],
      },
    },
  };
  const hashes = {
    storageHash: 'edb2eedf15ba501832cdba6905d1adb959b4ca1939a76c34193a2f968669c4d4',
    profileHash: 'cd6efaeff6fcb46dd626aa8a6cf5178ed1492a7c699a0afa209df503f5b190f6',
    executionHash: '3bf322885c8caba8949f645910600987a17c24874df8ddd48e6a9d9e61ced8d1',
  };

  it('passes when every hash matches, ignoring the hashes the contract stores', () => {
    expect(() =>
      assertContractHashes({
        contracts: [{ name: 'users', contract: savedContract, ...hashes }],
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
  });

  it('names the contract and the hash that differs', () => {
    expect(() =>
      assertContractHashes({
        contracts: [
          { name: 'users', contract: savedContract, ...hashes, profileHash: 'b'.repeat(64) },
        ],
        ...SQL_HOOKS,
      }),
    ).toThrow(
      `Contract "users": the profile hash is ${hashes.profileHash}, but ${'b'.repeat(64)} was expected.`,
    );
  });

  it('reports every difference in every contract', () => {
    expect(() =>
      assertContractHashes({
        contracts: [
          { name: 'first', contract: savedContract, ...hashes, storageHash: 'x' },
          { name: 'second', contract: savedContract, ...hashes, executionHash: 'y' },
        ],
        ...SQL_HOOKS,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.HASH_MISMATCH',
        message: [
          'The hash rules give different hashes for 2 saved contracts:',
          `Contract "first": the storage hash is ${hashes.storageHash}, but x was expected.`,
          `Contract "second": the execution hash is ${hashes.executionHash}, but y was expected.`,
        ].join('\n'),
        meta: { contracts: ['first', 'second'] },
      }),
    );
  });

  it('fails for a contract with an execution section and no expected execution hash', () => {
    const { executionHash: _executionHash, ...withoutExecutionHash } = hashes;
    expect(() =>
      assertContractHashes({
        contracts: [{ name: 'users', contract: savedContract, ...withoutExecutionHash }],
        ...SQL_HOOKS,
      }),
    ).toThrow(
      `Contract "users": the execution hash is ${hashes.executionHash}, but no execution hash was expected.`,
    );
  });

  it('fails for an expected execution hash when the contract has no execution section', () => {
    const { execution: _execution, ...withoutExecution } = savedContract;
    expect(() =>
      assertContractHashes({
        contracts: [{ name: 'users', contract: withoutExecution, ...hashes }],
        ...SQL_HOOKS,
      }),
    ).toThrow(
      `Contract "users": the contract has no execution section, but execution hash ${hashes.executionHash} was expected.`,
    );
  });
});
