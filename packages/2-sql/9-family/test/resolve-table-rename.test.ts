import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  SqlStorage,
  StorageTable,
  type StorageTableInput,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  resolveTableRenameAgainst,
  TABLE_RENAME_UNMATCHED_CODE,
  type TableRename,
} from '../src/core/migrations/resolve-table-rename';
import type { SchemaTables } from '../src/core/migrations/schema-tables';

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

describe('resolveTableRenameAgainst', () => {
  const endContract = contractOf({
    [UNBOUND_NAMESPACE_ID]: { UserProfile: table(), Account: table() },
    auth: { Session: table() },
  });
  const atThisPoint = (namespaces: Readonly<Record<string, readonly string[]>>): SchemaTables => ({
    hasTable: (namespaceId, tableName) => namespaces[namespaceId]?.includes(tableName) === true,
    hasColumn: () => false,
    namespacesWithTable: (tableName) =>
      Object.keys(namespaces).filter((namespaceId) => namespaces[namespaceId]?.includes(tableName)),
  });
  const lookup = atThisPoint({
    [UNBOUND_NAMESPACE_ID]: ['userProfile', 'Account'],
    auth: ['login'],
  });

  function refusalFor(tableRename: TableRename, against: SchemaTables = lookup) {
    const result = resolveTableRenameAgainst(against, endContract, tableRename);
    expect(result.ok).toBe(false);
    return result.ok ? undefined : result.failure;
  }

  it('resolves the namespace the lookup finds the table in', () => {
    const result = resolveTableRenameAgainst(lookup, endContract, rename('login', 'Session'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ namespaceId: 'auth', from: 'login', to: 'Session' });
  });

  it('resolves only in the namespace given, though another namespace has the table too', () => {
    const twice = atThisPoint({ auth: ['login'], app: ['login'] });
    const result = resolveTableRenameAgainst(
      twice,
      endContract,
      rename('login', 'Session', 'auth'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ namespaceId: 'auth', from: 'login', to: 'Session' });
  });

  it('refuses a table the namespace given does not have at this point of the migration', () => {
    expect(refusalFor(rename('userProfile', 'UserProfile', 'auth'))?.message).toContain(
      'table "auth.userProfile" does not exist at this point of the migration',
    );
  });

  it('refuses a table the lookup does not have at this point of the migration', () => {
    expect(refusalFor(rename('ghost', 'UserProfile'))).toMatchObject({
      code: TABLE_RENAME_UNMATCHED_CODE,
      message:
        'renameTable "ghost" to "UserProfile" does not match the migration\'s contracts: table "ghost" does not exist at this point of the migration.',
      why: "renameTable must name a table as the migration's earlier rename operations leave it, and a new name that the end contract has and that no earlier rename operation has already produced. Order the renameTable calls in the sequence the renames happen, make the rename its own schema change, and check the spelling, the table and the namespace.",
      meta: { from: 'ghost', to: 'UserProfile' },
    });
  });

  it('refuses a new name the lookup already has at this point of the migration', () => {
    expect(refusalFor(rename('userProfile', 'Account'))?.message).toContain(
      'table "Account" already exists at this point of the migration',
    );
  });

  it('refuses a new name the end contract does not have', () => {
    expect(refusalFor(rename('userProfile', 'Profile'))?.message).toContain(
      'table "Profile" does not exist in the end contract',
    );
  });

  it('refuses a table name the lookup has in more than one namespace when no namespace is given', () => {
    const twice = atThisPoint({ auth: ['userProfile'], app: ['userProfile'] });
    expect(refusalFor(rename('userProfile', 'UserProfile'), twice)?.message).toContain(
      'table "userProfile" is declared in more than one namespace (auth, app); name its namespace',
    );
  });
});
