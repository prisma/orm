import { coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqlStorage } from '../src/ir/sql-storage';
import { StorageTable } from '../src/ir/storage-table';
import { resolveStorageTable } from '../src/resolve-storage-table';
import { createTestSqlNamespace } from './test-support';

function tableNamed(_name: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function tableWithColumn(columnName: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
      [columnName]: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function twoNamespaceSameTableName(): {
  storage: SqlStorage;
  publicUsers: StorageTable;
  authUsers: StorageTable;
} {
  const publicUsers = tableWithColumn('email_addr');
  const authUsers = tableWithColumn('token_col');
  const storage = new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      public: createTestSqlNamespace({ id: 'public', entries: { table: { users: publicUsers } } }),
      auth: createTestSqlNamespace({ id: 'auth', entries: { table: { users: authUsers } } }),
    },
  });
  return { storage, publicUsers, authUsers };
}

describe('resolveStorageTable', () => {
  it('finds a table in whichever namespace declares it', () => {
    const authOnly = tableNamed('auth-only');
    const storage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        public: createTestSqlNamespace({ id: 'public', entries: { table: {} } }),
        auth: createTestSqlNamespace({ id: 'auth', entries: { table: { user: authOnly } } }),
      },
    });

    const resolved = resolveStorageTable(storage, 'user');

    expect(resolved).toEqual({ namespaceId: 'auth', table: authOnly });
  });

  it('resolves within a single namespace contract', () => {
    const users = tableNamed('users');
    const storage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { users } },
        }),
      },
    });

    const resolved = resolveStorageTable(storage, 'users');

    expect(resolved).toEqual({ namespaceId: UNBOUND_NAMESPACE_ID, table: users });
  });

  it('returns undefined when no namespace declares the table name', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        public: createTestSqlNamespace({ id: 'public', entries: { table: {} } }),
      },
    });

    expect(resolveStorageTable(storage, 'missing')).toBeUndefined();
  });

  it('resolves a same-bare-name table strictly within the given namespace', () => {
    const { storage, publicUsers, authUsers } = twoNamespaceSameTableName();

    expect(resolveStorageTable(storage, 'users', 'public')).toEqual({
      namespaceId: 'public',
      table: publicUsers,
    });
    expect(resolveStorageTable(storage, 'users', 'auth')).toEqual({
      namespaceId: 'auth',
      table: authUsers,
    });
  });

  it('throws naming the candidate namespaces for an ambiguous bare table name', () => {
    const { storage } = twoNamespaceSameTableName();

    expect(() => resolveStorageTable(storage, 'users')).toThrow(/ambiguous/i);
    expect(() => resolveStorageTable(storage, 'users')).toThrow(/auth/);
    expect(() => resolveStorageTable(storage, 'users')).toThrow(/public/);
  });

  it('ambiguous table error carries CONTRACT.TABLE_AMBIGUOUS', () => {
    const { storage } = twoNamespaceSameTableName();

    expect(() => resolveStorageTable(storage, 'users')).toThrowError(
      expect.objectContaining({
        code: 'CONTRACT.TABLE_AMBIGUOUS',
        meta: expect.objectContaining({ tableName: 'users' }),
      }) as unknown as Error,
    );
  });

  it('returns undefined for an unknown table within a given namespace', () => {
    const { storage } = twoNamespaceSameTableName();

    expect(resolveStorageTable(storage, 'missing', 'public')).toBeUndefined();
  });
});
