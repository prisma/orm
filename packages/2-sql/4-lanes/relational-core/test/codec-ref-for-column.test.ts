import {
  SqlStorage,
  type SqlStorage as SqlStorageType,
  StorageTable,
  toStorageTypeInstance,
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

  describe('typeRef columns', () => {
    type StorageTypes = NonNullable<ConstructorParameters<typeof SqlStorage>[0]['types']>;

    function storageWithTypeRef(types: StorageTypes | undefined, typeRef = 'money'): SqlStorage {
      return new SqlStorage({
        storageHash: STORAGE_HASH,
        namespaces: {
          public: createTestSqlNamespace({
            id: 'public',
            entries: {
              table: {
                invoice: new StorageTable({
                  columns: {
                    amount: {
                      codecId: 'pg/numeric@1',
                      dataType: 'pg/numeric',
                      nullable: false,
                      typeRef,
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
        ...(types !== undefined ? { types } : {}),
      });
    }

    it('takes the codec and type params from the referenced storage type', () => {
      const storage = storageWithTypeRef({
        money: toStorageTypeInstance({
          codecId: 'pg/numeric@1',
          dataType: 'pg/numeric',
          typeParams: { precision: 19 },
        }),
      });

      expect(codecRefForStorageColumn(storage, 'public', 'invoice', 'amount')).toEqual({
        codecId: 'pg/numeric@1',
        typeParams: { precision: 19 },
      });
    });

    it('omits type params when the referenced type declares none', () => {
      const storage = storageWithTypeRef({
        money: toStorageTypeInstance({ codecId: 'pg/numeric@1', dataType: 'pg/numeric' }),
      });

      expect(codecRefForStorageColumn(storage, 'public', 'invoice', 'amount')).toEqual({
        codecId: 'pg/numeric@1',
      });
    });

    it('returns undefined when the storage carries no matching type', () => {
      expect({
        noTypesBlock: codecRefForStorageColumn(
          storageWithTypeRef(undefined),
          'public',
          'invoice',
          'amount',
        ),
        danglingRef: codecRefForStorageColumn(
          storageWithTypeRef({
            other: toStorageTypeInstance({ codecId: 'pg/numeric@1', dataType: 'pg/numeric' }),
          }),
          'public',
          'invoice',
          'amount',
        ),
      }).toEqual({ noTypesBlock: undefined, danglingRef: undefined });
    });
  });
});
