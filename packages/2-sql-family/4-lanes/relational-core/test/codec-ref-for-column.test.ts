import {
  SqlStorage,
  type SqlStorage as SqlStorageType,
  StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { codecRefForStorageColumn } from '../src/codec-ref-for-column';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'pg/enum@1': 'pg/enum',
  'pg/int4@1': 'pg/int4',
  'pg/numeric@1': 'pg/numeric',
  'pg/text@1': 'pg/text',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

const STORAGE_HASH = blindCast<SqlStorageType['storageHash'], 'test storage hash literal'>('test');

function usersTable(columnName: string, codecId: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
      [columnName]: { codecId, dataType: dataTypeOf(codecId), nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function enumTable(): StorageTable {
  return new StorageTable({
    columns: {
      status: {
        codecId: 'pg/enum@1',
        dataType: 'pg/enum',
        nullable: false,
        typeParams: { typeName: 'aal_level' },
      },
    },
    primaryKey: { columns: ['status'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function twoNamespaceSameTableName(): SqlStorage {
  return new SqlStorage({
    storageHash: STORAGE_HASH,
    namespaces: {
      public: createTestSqlNamespace({
        id: 'public',
        entries: { table: { users: usersTable('email_addr', 'pg/text@1') } },
      }),
      auth: createTestSqlNamespace({
        id: 'auth',
        entries: { table: { users: usersTable('token_col', 'pg/int4@1') } },
      }),
    },
  });
}

describe('codecRefForStorageColumn', () => {
  it('resolves a same-bare-name column strictly within the given namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'email_addr')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'auth', 'users', 'token_col')).toEqual({
      codecId: 'pg/int4@1',
    });
  });

  it('returns undefined when the column belongs to a different namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'token_col')).toBeUndefined();
    expect(codecRefForStorageColumn(storage, 'auth', 'users', 'email_addr')).toBeUndefined();
  });

  it('returns undefined for an unknown column within the namespace', () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: { table: { users: usersTable('email_addr', 'pg/text@1') } },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'email_addr')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'public', 'users', 'missing')).toBeUndefined();
  });

  it("derives {codecId, typeParams} for an enum column, from the column's own typeParams", () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: { table: { session: enumTable() } },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'public', 'session', 'status')).toEqual({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'aal_level' },
    });
  });

  it('returns undefined for an unknown table', () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: { table: { users: usersTable('email_addr', 'pg/text@1') } },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'public', 'absent', 'email_addr')).toBeUndefined();
  });

  it('keeps a list column with type params a list', () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: {
            table: {
              invoice: new StorageTable({
                columns: {
                  amounts: {
                    codecId: 'pg/numeric@1',
                    dataType: 'pg/numeric',
                    nullable: false,
                    typeParams: { precision: 19 },
                    many: { elementNullable: false },
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'public', 'invoice', 'amounts')).toEqual({
      codecId: 'pg/numeric@1',
      typeParams: { precision: 19 },
      many: true,
    });
  });
});
