import { computeStorageHash } from '@internal/contract/hashing';
import { createPreserveEmptyPredicate, type PathPattern } from '@internal/contract/hashing-utils';
import { describe, expect, it } from 'vitest';
import { assertDescriptorSelfConsistency } from '../src/assert-descriptor-self-consistency';
import { MigrationToolsError } from '../src/errors';

const STORAGE_BODY = {
  tables: {
    test_box: {
      columns: {
        x: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
        y: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
      },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

const TARGET = 'postgres';
const FAMILY = 'sql';

const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'tables'],
  ['storage', 'namespaces', '*', 'tables', '*'],
  ['storage', 'namespaces', '*', 'tables', '*', ['uniques', 'indexes', 'foreignKeys']],
] as const satisfies readonly PathPattern[];

const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);

const SQL_HOOKS = { shouldPreserveEmpty: sqlPreserveEmpty };
const REAL_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: FAMILY,
  storage: STORAGE_BODY,
  ...SQL_HOOKS,
});

// Production-shape storage carries `storageHash` alongside the body; the
// helper must strip it before recomputing or it would feed its own
// output into its input and never match.
const STORAGE = { ...STORAGE_BODY, storageHash: REAL_HASH };

describe('assertDescriptorSelfConsistency', () => {
  it('returns silently when headRef.hash matches recomputed hash', () => {
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: STORAGE,
        headRefHash: REAL_HASH,
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
  });

  it('throws MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH on stale headRef.hash', () => {
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: STORAGE,
        headRefHash: 'stale-hash',
        ...SQL_HOOKS,
      }),
    ).toThrowError(MigrationToolsError);
  });

  it('error names the extension and includes both hashes in meta', () => {
    let captured: MigrationToolsError | undefined;
    try {
      assertDescriptorSelfConsistency({
        extensionId: 'cipherstash',
        target: TARGET,
        targetFamily: FAMILY,
        storage: STORAGE,
        headRefHash: 'stale-hash',
        ...SQL_HOOKS,
      });
    } catch (error) {
      if (MigrationToolsError.is(error)) captured = error;
    }
    expect(captured?.code).toBe('MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH');
    expect(captured?.why).toContain('"cipherstash"');
    expect(captured?.why).toContain('stale-hash');
    expect(captured?.why).toContain(REAL_HASH);
    expect(captured?.meta).toEqual({
      extensionId: 'cipherstash',
      recomputedHash: REAL_HASH,
      headRefHash: 'stale-hash',
    });
  });

  it('canonicalises storage before hashing — key order in input does not matter', () => {
    const reorderedStorage = {
      tables: STORAGE.tables,
      storageHash: STORAGE.storageHash,
    };
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: reorderedStorage,
        headRefHash: REAL_HASH,
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
  });

  it('strips storageHash from storage before recomputing (avoids self-referential hashing)', () => {
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: { ...STORAGE_BODY, storageHash: REAL_HASH },
        headRefHash: REAL_HASH,
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: STORAGE_BODY,
        headRefHash: REAL_HASH,
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
  });

  it('accepts on-disk namespace kind discriminators when recomputing', () => {
    // Target serializers (e.g. Postgres) inject a `kind` discriminator
    // into each namespace JSON envelope when writing contract.json.
    // `computeStorageHash` omits namespace `kind` for hashing, so
    // recomputing against on-disk JSON that carries `kind` still matches
    // the authoring-time hash.
    const namespacedBody = {
      namespaces: {
        public: {
          id: 'public',
          tables: STORAGE_BODY.tables,
        },
      },
    };
    const namespacedHash = computeStorageHash({
      target: TARGET,
      targetFamily: FAMILY,
      storage: namespacedBody,
      ...SQL_HOOKS,
    });
    const onDiskStorage = {
      namespaces: {
        public: {
          id: 'public',
          kind: 'postgres-schema',
          tables: STORAGE_BODY.tables,
        },
      },
      storageHash: namespacedHash,
    };
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'test-extension',
        target: TARGET,
        targetFamily: FAMILY,
        storage: onDiskStorage,
        headRefHash: namespacedHash,
        ...SQL_HOOKS,
      }),
    ).not.toThrow();
  });
});
