import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  isMaterializedSqlNamespace,
  SqlStorage,
  StorageTable,
  type StorageTableInput,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  applyTableRename,
  TABLE_RENAME_UNMATCHED_CODE,
  type TableRename,
} from '../src/core/migrations/apply-table-rename';

const idColumn = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };

function table(extra: Partial<StorageTableInput> = {}): StorageTable {
  return new StorageTable({
    columns: { id: idColumn },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...extra,
  });
}

function contractOf(
  namespaces: Readonly<Record<string, Readonly<Record<string, StorageTable>>>>,
  hashSeed = 'seed',
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      types: { Money: toStorageTypeInstance({ codecId: 'pg/numeric@1', nativeType: 'numeric' }) },
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, tables]) => [
          id,
          createTestSqlNamespace({ id, entries: { table: tables } }),
        ]),
      ),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const rename = (from: string, to: string, namespaceId?: string): TableRename => ({
  namespaceId,
  from,
  to,
});

function tablesOf(contract: Contract<SqlStorage>, namespaceId: string): readonly string[] {
  return Object.keys(contract.storage.namespaces[namespaceId]?.entries.table ?? {});
}

describe('applyTableRename', () => {
  it('re-keys the table under its new name and retargets every foreign key that named it', () => {
    const startContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: {
        userProfile: table({
          columns: { id: idColumn, parentId: { ...idColumn, nullable: true } },
          foreignKeys: [
            {
              source: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['parentId'],
              },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['id'],
              },
              name: 'userProfile_parent_fkey',
            },
          ],
        }),
        post: table({
          columns: { id: idColumn, authorId: idColumn },
          foreignKeys: [
            {
              source: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'post',
                columns: ['authorId'],
              },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['id'],
              },
            },
          ],
        }),
      },
    });
    const endContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table(), post: table() },
    });

    const result = applyTableRename({
      startContract,
      endContract,
      rename: rename('userProfile', 'UserProfile'),
      renameTableReferences: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rename).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      from: 'userProfile',
      to: 'UserProfile',
    });
    const renamed = result.value.contract;
    expect(tablesOf(renamed, UNBOUND_NAMESPACE_ID)).toEqual(['UserProfile', 'post']);
    const renamedTable =
      renamed.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['UserProfile'];
    expect(renamedTable).toBeInstanceOf(StorageTable);
    expect(Object.keys(renamedTable?.columns ?? {})).toEqual(['id', 'parentId']);
    expect(
      renamedTable?.foreignKeys.map((fk) => [fk.source.tableName, fk.target.tableName, fk.name]),
    ).toEqual([['UserProfile', 'UserProfile', 'userProfile_parent_fkey']]);
    const post = renamed.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['post'];
    expect(post?.foreignKeys.map((fk) => [fk.source.tableName, fk.target.tableName])).toEqual([
      ['post', 'UserProfile'],
    ]);
  });

  it('keeps the namespace class, the storage hash and types, and leaves the input untouched', () => {
    const startContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { userProfile: table() },
      audit: { log: table() },
    });
    const endContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table() },
      audit: { log: table() },
    });

    const result = applyTableRename({
      startContract,
      endContract,
      rename: rename('userProfile', 'UserProfile'),
      renameTableReferences: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.contract;
    const namespace = renamed.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(isMaterializedSqlNamespace(namespace)).toBe(true);
    expect(Object.getPrototypeOf(namespace)).toBe(
      Object.getPrototypeOf(startContract.storage.namespaces[UNBOUND_NAMESPACE_ID]),
    );
    expect(namespace?.id).toBe(UNBOUND_NAMESPACE_ID);
    expect(renamed.storage.namespaces['audit']).toBe(startContract.storage.namespaces['audit']);
    expect(renamed.storage.storageHash).toBe(startContract.storage.storageHash);
    expect(renamed.storage.types).toEqual(startContract.storage.types);
    expect(renamed.profileHash).toBe(startContract.profileHash);
    expect(tablesOf(startContract, UNBOUND_NAMESPACE_ID)).toEqual(['userProfile']);
  });

  it('finds the table in whichever namespace declares it when no namespace is given', () => {
    const startContract = contractOf({ auth: { userProfile: table() }, app: { post: table() } });
    const endContract = contractOf({ auth: { UserProfile: table() }, app: { post: table() } });

    const result = applyTableRename({
      startContract,
      endContract,
      rename: rename('userProfile', 'UserProfile'),
      renameTableReferences: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rename).toEqual({
      namespaceId: 'auth',
      from: 'userProfile',
      to: 'UserProfile',
    });
    expect(tablesOf(result.value.contract, 'auth')).toEqual(['UserProfile']);
  });

  it('renames only in the namespace given', () => {
    const startContract = contractOf({
      auth: { userProfile: table() },
      app: { userProfile: table() },
    });
    const endContract = contractOf({
      auth: { UserProfile: table() },
      app: { userProfile: table() },
    });

    const result = applyTableRename({
      startContract,
      endContract,
      rename: rename('userProfile', 'UserProfile', 'auth'),
      renameTableReferences: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rename).toEqual({
      namespaceId: 'auth',
      from: 'userProfile',
      to: 'UserProfile',
    });
    expect(tablesOf(result.value.contract, 'app')).toEqual(['userProfile']);
  });

  it("lets the target rename its own references to the table in the table's namespace", () => {
    const startContract = contractOf({
      auth: { userProfile: table(), account: table() },
      app: { userProfile: table() },
    });
    const endContract = contractOf({
      auth: { UserProfile: table(), account: table() },
      app: { userProfile: table() },
    });
    const calls: string[] = [];

    const result = applyTableRename({
      startContract,
      endContract,
      rename: rename('userProfile', 'UserProfile', 'auth'),
      renameTableReferences: (entries, applied) => {
        calls.push(`${applied.namespaceId}:${applied.from}>${applied.to}`);
        return { ...entries, marker: { [applied.to]: { tableName: applied.to } } };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual(['auth:userProfile>UserProfile']);
    expect(result.value.contract.storage.namespaces['auth']?.entries['marker']).toEqual({
      UserProfile: { tableName: 'UserProfile' },
    });
    expect(result.value.contract.storage.namespaces['app']?.entries['marker']).toBeUndefined();
  });

  describe('refusals', () => {
    const startContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { userProfile: table(), Account: table() },
    });
    const endContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table(), Account: table() },
    });

    function refusalFor(
      tableRename: TableRename,
      start: Contract<SqlStorage> | null = startContract,
    ) {
      const result = applyTableRename({
        startContract: start,
        endContract,
        rename: tableRename,
        renameTableReferences: undefined,
      });
      expect(result.ok).toBe(false);
      return result.ok ? undefined : result.failure;
    }

    it('refuses a table the start contract does not have', () => {
      expect(refusalFor(rename('ghost', 'UserProfile'))).toMatchObject({
        code: TABLE_RENAME_UNMATCHED_CODE,
        message:
          'renameTable "ghost" to "UserProfile" does not match the migration\'s contracts: table "ghost" does not exist in the start contract.',
        meta: { from: 'ghost', to: 'UserProfile' },
      });
    });

    it('refuses a new name the start contract already has', () => {
      expect(refusalFor(rename('userProfile', 'Account'))?.message).toContain(
        'table "Account" already exists in the start contract',
      );
    });

    it('refuses a new name the end contract does not have', () => {
      expect(refusalFor(rename('userProfile', 'Profile'))?.message).toContain(
        'table "Profile" does not exist in the end contract',
      );
    });

    it('refuses a namespace the start contract does not have', () => {
      expect(refusalFor(rename('userProfile', 'UserProfile', 'auth'))?.message).toContain(
        'table "auth.userProfile" does not exist in the start contract',
      );
    });

    it('refuses a migration without a start contract', () => {
      expect(refusalFor(rename('userProfile', 'UserProfile'), null)).toMatchObject({
        code: TABLE_RENAME_UNMATCHED_CODE,
        message: expect.stringContaining('the migration has no start contract'),
      });
    });

    it('refuses a table name declared in more than one namespace when no namespace is given', () => {
      const result = applyTableRename({
        startContract: contractOf({
          auth: { userProfile: table() },
          app: { userProfile: table() },
        }),
        endContract: contractOf({ auth: { UserProfile: table() }, app: { userProfile: table() } }),
        rename: rename('userProfile', 'UserProfile'),
        renameTableReferences: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.message).toContain(
        'table "userProfile" is declared in more than one namespace (auth, app); name its namespace',
      );
    });
  });
});
