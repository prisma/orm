import {
  type CanonicalizeContractOptions,
  canonicalizeContract as canonicalizeContractRaw,
} from '@internal/contract/hashing';
import {
  createPreserveEmptyPredicate,
  createStorageSort,
  type NamedArraySortTarget,
  type PathPattern,
} from '@internal/contract/hashing-utils';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { createTestContract } from './utils';

function unboundNamespaceTables(tables: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      },
    },
  };
}

function tablesFromCanonicalStorage(storage: Record<string, unknown>): Record<string, unknown> {
  const namespaces = storage['namespaces'] as Record<string, unknown>;
  const unbound = namespaces[UNBOUND_NAMESPACE_ID] as Record<string, unknown>;
  const entries = unbound['entries'] as Record<string, unknown>;
  return entries['table'] as Record<string, unknown>;
}

const identitySerialize = (input: Contract): JsonObject => input as unknown as JsonObject;

const canonicalizeContract = (
  c: Contract,
  opts?: Omit<CanonicalizeContractOptions, 'serializeContract'>,
): string => canonicalizeContractRaw(c, { serializeContract: identitySerialize, ...opts });

const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'foreignKeys', ['constraint', 'index']],
] as const satisfies readonly PathPattern[];

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);
const sqlSortStorage = createStorageSort(sqlSortTargets);

describe('canonicalization', () => {
  it('orders top-level sections correctly', () => {
    const ir = createTestContract({
      capabilities: { postgres: { jsonAgg: true } },
      meta: { emitterVersion: 'test' },
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;

    const keys = Object.keys(parsed);
    const schemaVersionIndex = keys.indexOf('schemaVersion');
    const targetFamilyIndex = keys.indexOf('targetFamily');
    const targetIndex = keys.indexOf('target');
    const domainIndex = keys.indexOf('domain');
    const storageIndex = keys.indexOf('storage');
    const capabilitiesIndex = keys.indexOf('capabilities');
    const metaIndex = keys.indexOf('meta');

    expect(schemaVersionIndex).toBeLessThan(targetFamilyIndex);
    expect(targetFamilyIndex).toBeLessThan(targetIndex);
    expect(targetIndex).toBeLessThan(domainIndex);
    expect(domainIndex).toBeLessThan(storageIndex);
    expect(storageIndex).toBeLessThan(capabilitiesIndex);
    expect(capabilitiesIndex).toBeLessThan(metaIndex);
  });

  it('preserves nullable false on columns', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            email: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
          },
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const id = columns['id'] as Record<string, unknown>;
    const email = columns['email'] as Record<string, unknown>;
    expect(id['nullable']).toBe(false);
    expect(email['nullable']).toBe(true);
  });

  it('preserves nullable:false for columns with defaults', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            created_at: {
              codecId: 'pg/timestamptz-temporal@1',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
            updated_at: {
              codecId: 'pg/timestamptz-temporal@1',
              nativeType: 'timestamptz',
              nullable: true,
            },
          },
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const createdAt = columns['created_at'] as Record<string, unknown>;
    const updatedAt = columns['updated_at'] as Record<string, unknown>;
    expect(createdAt['nullable']).toBe(false);
    expect(updatedAt['nullable']).toBe(true);
  });

  it('preserves nullable:true for columns with defaults', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            bio: {
              codecId: 'pg/text@1',
              nativeType: 'text',
              nullable: true,
              default: { kind: 'literal', value: '' },
            },
          },
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const bio = columns['bio'] as Record<string, unknown>;
    expect(bio['nullable']).toBe(true);
    expect(bio['default']).toEqual({ kind: 'literal', value: '' });
  });

  it('omits empty arrays and objects except required ones', () => {
    const ir = createTestContract();

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      domain: {
        namespaces: expect.anything(),
      },
      storage: {
        namespaces: expect.anything(),
      },
    });
    // Required top-level fields (capabilities, extensions, meta) are preserved even when empty.
    expect(parsed).toMatchObject({
      capabilities: expect.anything(),
      extensions: expect.anything(),
      meta: expect.anything(),
    });
    expect(parsed).not.toHaveProperty('relations');
  });

  it('preserves an empty per-namespace tables slot when SQL shouldPreserveEmpty hook is provided', () => {
    const ir = createTestContract({
      storage: {
        namespaces: {
          public: { id: 'public', entries: { table: {} } },
        },
      },
    });

    const result = canonicalizeContract(ir, { shouldPreserveEmpty: sqlPreserveEmpty });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const namespaces = storage['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    expect(publicNs).toMatchObject({ id: 'public', entries: { table: {} } });
  });

  it('preserves semantic array order for column lists', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            first: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            second: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: {
            columns: ['second', 'first'],
          },
        },
      }),
    });

    const result1 = canonicalizeContract(ir);

    const ir2 = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            first: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            second: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: {
            columns: ['first', 'second'],
          },
        },
      }),
    });

    const result2 = canonicalizeContract(ir2);

    expect(result1).not.toBe(result2);
  });

  it('sorts indexes by canonical name when SQL sortStorage hook is provided', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          },
          indexes: [
            { columns: ['id'], name: 'user_email_idx' },
            { columns: ['id'], name: 'user_name_idx' },
          ],
        },
      }),
    });

    const result = canonicalizeContract(ir, { sortStorage: sqlSortStorage });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const indexes = user['indexes'] as Array<{ name: string }>;
    const indexNames = indexes.map((idx) => idx.name);
    expect(indexNames).toEqual(['user_email_idx', 'user_name_idx']);
  });

  it('sorts uniques by canonical name when SQL sortStorage hook is provided', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            username: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          uniques: [
            { columns: ['username'], name: 'user_username_key' },
            { columns: ['email'], name: 'user_email_key' },
          ],
        },
      }),
    });

    const result = canonicalizeContract(ir, { sortStorage: sqlSortStorage });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const uniques = user['uniques'] as Array<{ name: string }>;
    const uniqueNames = uniques.map((u) => u.name);
    expect(uniqueNames).toEqual(['user_email_key', 'user_username_key']);
  });

  it('preserves column order in composite unique constraints', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            first_name: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            last_name: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          uniques: [{ columns: ['last_name', 'first_name'], name: 'user_name_key' }],
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const uniques = user['uniques'] as Array<{ columns: string[] }>;
    expect(uniques[0]!.columns).toEqual(['last_name', 'first_name']);
  });

  it('sorts nested object keys lexicographically', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            z_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            a_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            m_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const columnKeys = Object.keys(columns);
    expect(columnKeys).toEqual(['a_field', 'm_field', 'z_field']);
  });

  describe('namespace table slot preservation (SQL hook required)', () => {
    it('preserves empty namespace table entries when SQL shouldPreserveEmpty hook is provided', () => {
      const ir = createTestContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: { users: {}, posts: {} },
              },
            },
          },
        },
      });

      const result = canonicalizeContract(ir, { shouldPreserveEmpty: sqlPreserveEmpty });
      const parsed = JSON.parse(result) as Record<string, unknown>;
      const tables = tablesFromCanonicalStorage(parsed['storage'] as Record<string, unknown>);
      expect(tables['users']).toEqual({});
      expect(tables['posts']).toEqual({});
    });

    it('sorts table names lexicographically within a namespace', () => {
      const ir = createTestContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: { zebras: {}, apples: {}, mangoes: {} },
              },
            },
          },
        },
      });

      const result = canonicalizeContract(ir, { shouldPreserveEmpty: sqlPreserveEmpty });
      const parsed = JSON.parse(result) as Record<string, unknown>;
      const tables = tablesFromCanonicalStorage(parsed['storage'] as Record<string, unknown>);
      expect(Object.keys(tables)).toEqual(['apples', 'mangoes', 'zebras']);
    });

    it('produces different hashes when namespace tables differ', () => {
      const ir1 = createTestContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: { users: {} },
              },
            },
          },
        },
      });
      const ir2 = createTestContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: { users: {}, posts: {} },
              },
            },
          },
        },
      });

      const result1 = canonicalizeContract(ir1, { shouldPreserveEmpty: sqlPreserveEmpty });
      const result2 = canonicalizeContract(ir2, { shouldPreserveEmpty: sqlPreserveEmpty });
      expect(result1).not.toBe(result2);
    });
  });

  it('sorts extension namespaces lexicographically', () => {
    const ir = createTestContract({
      extensions: {
        pgvector: { version: '0.0.1' },
        postgres: { version: '0.0.1' },
        another: { version: '0.0.1' },
      },
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const extensions = parsed['extensions'] as Record<string, unknown>;
    const extensionKeys = Object.keys(extensions);
    expect(extensionKeys).toEqual(['another', 'pgvector', 'postgres']);
  });

  it('strips empty typeParams from storage.types entries under SQL hooks', () => {
    const ir = createTestContract({
      storage: {
        namespaces: {},
        types: {
          U: { codecId: 'x', nativeType: 'y', typeParams: {} },
        },
      },
    });

    const result = canonicalizeContract(ir, { shouldPreserveEmpty: sqlPreserveEmpty });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const types = storage['types'] as Record<string, unknown>;
    const u = types['U'] as Record<string, unknown>;
    expect(u).toEqual({ codecId: 'x', nativeType: 'y' });
  });

  it('omits generated false', () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false, generated: false },
          },
        },
      }),
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = tablesFromCanonicalStorage(storage);
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const id = columns['id'] as Record<string, unknown>;
    expect(id['generated']).toBeUndefined();
  });
});

describe('framework canonicalizer has no SQL/Mongo storage path knowledge', () => {
  it('canonicalization.ts does not hardcode tables, indexes, uniques, or foreignKeys path guards', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../0-foundation/contract/src/canonicalization.ts',
    );
    const source = await readFile(sourcePath, 'utf8');
    const forbidden = [
      "'tables'",
      "'indexes'",
      "'uniques'",
      "'foreignKeys'",
      'sortIndexesAndUniques',
      'sortTableArrays',
      'isNamespaceTable',
      'isRequiredNamespaceTables',
      'isStorageTypeTypeParams',
      'isFkBooleanField',
    ];
    for (const token of forbidden) {
      expect(source, `framework canonicalizer must not reference ${token}`).not.toContain(token);
    }
  });
});
