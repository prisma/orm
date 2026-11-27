import { describe, expect, it } from 'vitest';
import {
  compareByNameProperty,
  createStorageSort,
  type NamedArraySortTarget,
} from '../src/canonicalization-storage-sort';

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

describe('createStorageSort', () => {
  const normalizeStorage = createStorageSort(sqlSortTargets);

  it('sorts indexes and uniques by name within each table', () => {
    const storage = {
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: {
            table: {
              users: {
                columns: {},
                indexes: [{ name: 'idx_z' }, { name: 'idx_a' }],
                uniques: [{ name: 'uq_z' }, { name: 'uq_a' }],
              },
            },
          },
        },
      },
    };

    const sorted = normalizeStorage(storage) as typeof storage;
    const table = sorted.namespaces.__unbound__.entries.table.users;
    expect(table.indexes.map((i) => i.name)).toEqual(['idx_a', 'idx_z']);
    expect(table.uniques.map((u) => u.name)).toEqual(['uq_a', 'uq_z']);
  });

  it('returns non-object storage unchanged', () => {
    expect(normalizeStorage(null)).toBe(null);
    expect(normalizeStorage('x')).toBe('x');
  });

  it('passes through namespaces without a table slot', () => {
    const storage = {
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: { collection: { posts: { columns: {} } } },
        },
      },
    };
    expect(normalizeStorage(storage)).toEqual(storage);
  });

  it('passes non-object namespace and table entries through unchanged', () => {
    const storage = {
      namespaces: {
        broken: null,
        __unbound__: {
          id: '__unbound__',
          entries: { table: { bad: null } },
        },
      },
    };
    const sorted = normalizeStorage(storage) as typeof storage;
    expect(sorted.namespaces.broken).toBeNull();
    expect(sorted.namespaces.__unbound__.entries.table.bad).toBeNull();
  });

  it('sorts entries without name using empty-string fallback', () => {
    const storage = {
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: {
            table: {
              users: {
                columns: {},
                indexes: [{ columns: ['b'] }, { name: 'idx_a', columns: ['a'] }],
              },
            },
          },
        },
      },
    };
    const sorted = normalizeStorage(storage) as typeof storage;
    const indexes = sorted.namespaces.__unbound__.entries.table.users.indexes;
    expect(indexes[0]).toEqual({ columns: ['b'] });
    expect(indexes[1]).toEqual({ name: 'idx_a', columns: ['a'] });
  });
});

describe('compareByNameProperty', () => {
  it('orders named objects lexicographically', () => {
    expect(compareByNameProperty({ name: 'b' }, { name: 'a' })).toBeGreaterThan(0);
    expect(compareByNameProperty({ name: 'a' }, { name: 'b' })).toBeLessThan(0);
  });

  it('treats missing name as empty string', () => {
    expect(compareByNameProperty({}, { name: 'a' })).toBeLessThan(0);
  });

  it('uses code-unit order, not locale collation (Z < a)', () => {
    expect(compareByNameProperty({ name: 'Z' }, { name: 'a' })).toBeLessThan(0);
  });
});
