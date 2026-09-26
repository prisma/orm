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

    it('scalar column (no many key) stays byte-identical — no many:false emitted', () => {
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

    it('omits many from scalar column (no many:false)', () => {
      const column = col('text', 'pg/text@1');
      expect(column).not.toHaveProperty('many');
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

    it('leaves many undefined for scalar columns', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.many).toBeUndefined();
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

  describe('StorageColumn optional fields', () => {
    it('accepts noCheck and sets the field', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        noCheck: ['membership'],
      });
      expect(column.noCheck).toEqual(['membership']);
    });

    it('leaves noCheck undefined when not provided', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.noCheck).toBeUndefined();
    });

    it('accepts typeParams and sets the field', () => {
      const column = new StorageColumn({
        nativeType: 'varchar',
        codecId: 'pg/varchar@1',
        nullable: false,
        typeParams: { length: 255 },
      });
      expect(column.typeParams).toEqual({ length: 255 });
    });

    it('leaves typeParams undefined when not provided', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.typeParams).toBeUndefined();
    });

    it('accepts typeRef and sets the field', () => {
      const column = new StorageColumn({
        nativeType: 'user_status',
        codecId: 'pg/enum@1',
        nullable: false,
        typeRef: 'UserStatus',
      });
      expect(column.typeRef).toBe('UserStatus');
    });

    it('leaves typeRef undefined when not provided', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.typeRef).toBeUndefined();
    });
  });

  describe('StorageColumn.from', () => {
    it('constructs a new instance from plain input', () => {
      const column = StorageColumn.from({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column).toBeInstanceOf(StorageColumn);
    });

    it('passes an existing instance through unchanged', () => {
      const original = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      const result = StorageColumn.from(original);
      expect(result).toBe(original);
    });
  });
});
