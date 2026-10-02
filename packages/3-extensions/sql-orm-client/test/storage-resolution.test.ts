import type { Contract } from '@internal/contract/types';
import {
  SqlStorage,
  type SqlStorage as SqlStorageType,
  StorageTable,
} from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  requireStorageTableForContract,
  storageTableForContract,
  tableSourceForContract,
} from '../src/storage-resolution';

const STORAGE_HASH = blindCast<SqlStorageType['storageHash'], 'test storage hash literal'>('test');

function usersTable(columnName: string): StorageTable {
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

function contractWith(storage: SqlStorageType): Contract<SqlStorageType> {
  return blindCast<
    Contract<SqlStorageType>,
    'minimal contract wrapping storage for resolver tests'
  >({ storage });
}

function twoNamespaceSameTableName(): Contract<SqlStorageType> {
  return contractWith(
    new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: postgresCreateNamespace({
          id: 'public',
          entries: { table: { users: usersTable('email_addr') } },
        }),
        auth: postgresCreateNamespace({
          id: 'auth',
          entries: { table: { users: usersTable('token_col') } },
        }),
      },
    }),
  );
}

describe('storage-resolution coordinate-aware lookups', () => {
  it('enumerates columns strictly within the given namespace', () => {
    const contract = twoNamespaceSameTableName();

    expect(Object.keys(storageTableForContract(contract, 'public', 'users').columns)).toEqual([
      'id',
      'email_addr',
    ]);
    expect(Object.keys(storageTableForContract(contract, 'auth', 'users').columns)).toEqual([
      'id',
      'token_col',
    ]);
  });

  it('resolves the namespace coordinate strictly', () => {
    const contract = twoNamespaceSameTableName();

    expect(requireStorageTableForContract(contract, 'auth', 'users').namespaceId).toBe('auth');
    expect(tableSourceForContract(contract, 'public', 'users').namespaceId).toBe('public');
  });

  it('resolves a bare table name within the given namespace', () => {
    const contract = contractWith(
      new SqlStorage({
        storageHash: STORAGE_HASH,
        namespaces: {
          public: postgresCreateNamespace({
            id: 'public',
            entries: { table: { users: usersTable('email_addr') } },
          }),
        },
      }),
    );

    expect(Object.keys(storageTableForContract(contract, 'public', 'users').columns)).toEqual([
      'id',
      'email_addr',
    ]);
  });
});
