import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, table } from '../src/factories';
import { StorageColumn } from '../src/ir/storage-column';
import type { SqlStorage } from '../src/types';
import { validateStorage } from '../src/validators';

function unboundTables<T extends Record<string, unknown>>(tables: T) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: tables },
      },
    },
  };
}

describe('StorageColumn many', () => {
  describe('contract.json round-trip', () => {
    it('round-trips a many:true column through serialize → parse → deep-equal', () => {
      const postTable = table({
        tags: col('text', 'pg/text@1', false, { many: true }),
      });

      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;

      const serialized = JSON.stringify(s);
      const parsed = JSON.parse(serialized) as unknown;

      validateStorage(parsed);
      const tagsColumn = (parsed as SqlStorage).namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.[
        'post'
      ]?.columns['tags'] as StorageColumn | undefined;

      expect(tagsColumn).toBeDefined();
      expect(tagsColumn).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
    });

    it('round-trips elementNullable:true only on a many column', () => {
      const postTable = table({
        tags: col('text', 'pg/text@1', false, { many: true, elementNullable: true }),
      });

      const storage = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;

      const serialized = JSON.stringify(storage);
      const parsed = JSON.parse(serialized) as unknown;

      validateStorage(parsed);
      const tagsColumn = (parsed as SqlStorage).namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.[
        'post'
      ]?.columns['tags'] as StorageColumn | undefined;

      expect(tagsColumn).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
        elementNullable: true,
      });
    });

    it('scalar column (no many key) stays byte-identical — no optional markers emitted', () => {
      const postTable = table({
        title: col('text', 'pg/text@1'),
      });

      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;

      const serialized = JSON.stringify(s);
      const parsed = JSON.parse(serialized) as unknown;

      validateStorage(parsed);
      const titleColumn = (parsed as SqlStorage).namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.[
        'post'
      ]?.columns['title'] as StorageColumn | undefined;

      expect(titleColumn).toBeDefined();
      expect(titleColumn).not.toHaveProperty('many');
      expect(titleColumn).not.toHaveProperty('elementNullable');
      expect(titleColumn).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
    });
  });

  describe('col() factory', () => {
    it('creates a many:true column when many option is set', () => {
      const column = col('text', 'pg/text@1', false, { many: true });
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
    });

    it('creates an element-nullable many column', () => {
      const column = col('text', 'pg/text@1', false, { many: true, elementNullable: true });
      expect(column).toMatchObject({ many: true, elementNullable: true });
    });

    it('rejects elementNullable without many:true when the options type is bypassed', () => {
      const invalidOptions = { elementNullable: true } as unknown as Parameters<typeof col>[3];

      expect(() => col('text', 'pg/text@1', false, invalidOptions)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: 'StorageColumn elementNullable requires many:true.',
        }),
      );
    });

    it('omits optional markers from scalar column', () => {
      const column = col('text', 'pg/text@1');
      expect(column).not.toHaveProperty('many');
      expect(column).not.toHaveProperty('elementNullable');
    });
  });

  describe('StorageColumn IR', () => {
    it('accepts many:true in constructor and sets the flag', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
      expect(column.many).toBe(true);
    });

    it('accepts elementNullable:true with many:true', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
        elementNullable: true,
      });
      expect(column).toMatchObject({ many: true, elementNullable: true });
    });

    it('rejects elementNullable without many:true when the input type is bypassed', () => {
      const invalidInput = {
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        elementNullable: true,
      } as unknown as ConstructorParameters<typeof StorageColumn>[0];

      expect(() => new StorageColumn(invalidInput)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: 'StorageColumn elementNullable requires many:true.',
        }),
      );
    });

    it('leaves optional markers undefined for scalar columns', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.many).toBeUndefined();
      expect(column.elementNullable).toBeUndefined();
      expect(Object.keys(column)).not.toContain('elementNullable');
    });
  });

  describe('validateStorage', () => {
    it('accepts a column with many:true', () => {
      const raw = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'test-sql-namespace',
            entries: {
              table: {
                post: {
                  columns: {
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).not.toThrow();
    });

    it('rejects elementNullable without many:true', () => {
      const raw = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'test-sql-namespace',
            entries: {
              table: {
                post: {
                  columns: {
                    tags: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      elementNullable: true,
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).toThrow();
    });

    it('rejects elementNullable:false', () => {
      const raw = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'test-sql-namespace',
            entries: {
              table: {
                post: {
                  columns: {
                    tags: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: true,
                      elementNullable: false,
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).toThrow();
    });

    it('rejects a column with many:42 (non-boolean)', () => {
      const raw = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'test-sql-namespace',
            entries: {
              table: {
                post: {
                  columns: {
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: 42 },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).toThrow();
    });
  });
});
