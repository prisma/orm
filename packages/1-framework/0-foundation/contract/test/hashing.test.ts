import { describe, expect, it } from 'vitest';
import type { PreserveEmptyPredicate, StorageSort } from '../src/canonicalization';

import { computeExecutionHash, computeProfileHash, computeStorageHash } from '../src/hashing';

const sqlPreserveEmpty: PreserveEmptyPredicate = (path) => {
  const len = path.length;
  if (len < 2 || path[0] !== 'storage') return false;
  if (path[1] === 'namespaces') {
    if (len === 5 && path[3] === 'entries' && path[4] === 'table') return true;
    if (len === 6 && path[3] === 'entries' && path[4] === 'table') return true;
  }
  return false;
};

const sqlSortStorage: StorageSort = (storage) => storage;

const SQL_HOOKS = { shouldPreserveEmpty: sqlPreserveEmpty, sortStorage: sqlSortStorage };

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
                  columns: { id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } },
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
                a: { columns: { x: { codecId: 'pg/text@1', nativeType: 'text' } } },
                b: { columns: { y: { codecId: 'pg/text@1', nativeType: 'text' } } },
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
                b: { columns: { y: { codecId: 'pg/text@1', nativeType: 'text' } } },
                a: { columns: { x: { codecId: 'pg/text@1', nativeType: 'text' } } },
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
          x: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false },
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
