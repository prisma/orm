import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  COLUMN_RENAME_UNMATCHED_CODE,
  type ColumnRenameRequest,
  resolveColumnRenameAgainst,
} from '../src/core/migrations/resolve-column-rename';
import type { SchemaTables } from '../src/core/migrations/schema-tables';

const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

function contractWithColumns(
  tables: Readonly<Record<string, readonly string[]>>,
  namespaceId: string = UNBOUND_NAMESPACE_ID,
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('seed'),
    storage: new SqlStorage({
      storageHash: coreHash('seed'),
      namespaces: {
        [namespaceId]: createTestSqlNamespace({
          id: namespaceId,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([name, columns]) => [
                name,
                new StorageTable({
                  columns: Object.fromEntries(columns.map((column) => [column, text])),
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function schemaTables(
  namespaces: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>,
): SchemaTables {
  const columnsOf = (namespaceId: string, table: string) => namespaces[namespaceId]?.[table];
  return {
    hasTable: (namespaceId, table) => columnsOf(namespaceId, table) !== undefined,
    hasColumn: (namespaceId, table, column) =>
      columnsOf(namespaceId, table)?.includes(column) === true,
    tablesNamed: (namespaceId, table) =>
      columnsOf(namespaceId, table) === undefined ? [] : [table],
    columnsNamed: (namespaceId, table, column) =>
      (columnsOf(namespaceId, table) ?? []).filter(
        (existing) => existing.toLowerCase() === column.toLowerCase(),
      ),
    namespacesWithTable: (table) =>
      Object.keys(namespaces).filter((namespaceId) => columnsOf(namespaceId, table) !== undefined),
  };
}

const rename = (
  table: string,
  from: string,
  to: string,
  namespaceId?: string,
): ColumnRenameRequest => ({
  namespaceId,
  table,
  from,
  to,
});

describe('resolveColumnRenameAgainst', () => {
  const endContract = contractWithColumns({ User: ['id', 'fullName'] });
  const lookup = schemaTables({ [UNBOUND_NAMESPACE_ID]: { User: ['id', 'name'] } });

  function refusalFor(columnRename: ColumnRenameRequest, against: SchemaTables = lookup) {
    const result = resolveColumnRenameAgainst(against, endContract, columnRename);
    if (result.ok) throw new Error('expected a refusal');
    return result.failure;
  }

  it('resolves the namespace the lookup finds the table in', () => {
    const result = resolveColumnRenameAgainst(
      lookup,
      endContract,
      rename('User', 'name', 'fullName'),
    );
    expect(result.ok && result.value).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      table: 'User',
      from: 'name',
      to: 'fullName',
    });
  });

  it('refuses a table the lookup does not have at this point of the migration', () => {
    expect(refusalFor(rename('Ghost', 'name', 'fullName'))).toMatchObject({
      code: COLUMN_RENAME_UNMATCHED_CODE,
      message: expect.stringContaining(
        'table "Ghost" does not exist at this point of the migration',
      ),
      meta: { table: 'Ghost', from: 'name', to: 'fullName' },
    });
  });

  it('refuses a column the table does not have at this point of the migration', () => {
    expect(refusalFor(rename('User', 'email', 'fullName')).message).toContain(
      'column "User"."email" does not exist at this point of the migration',
    );
  });

  it('refuses a new name the table already has at this point of the migration', () => {
    expect(refusalFor(rename('User', 'name', 'id')).message).toContain(
      'column "User"."id" already exists at this point of the migration',
    );
  });

  it('refuses a new name the table has under another case where the target ignores case', () => {
    const against = schemaTables({ [UNBOUND_NAMESPACE_ID]: { User: ['other', 'FullName'] } });
    expect(refusalFor(rename('User', 'other', 'fullName'), against).message).toContain(
      'column "User"."fullName" already exists at this point of the migration as "FullName"',
    );
  });

  it('resolves a rename that only changes the case of the name', () => {
    const endUpper = contractWithColumns({ User: ['id', 'Name'] });
    const result = resolveColumnRenameAgainst(lookup, endUpper, rename('User', 'name', 'Name'));
    expect(result.ok).toBe(true);
  });

  it('refuses a new name the end contract does not have', () => {
    const against = schemaTables({ [UNBOUND_NAMESPACE_ID]: { User: ['id', 'name'] } });
    expect(refusalFor(rename('User', 'name', 'title'), against).message).toContain(
      'column "User"."title" does not exist in the end contract',
    );
  });

  it('refuses a table name the lookup has in more than one namespace when no namespace is given', () => {
    const twice = schemaTables({ auth: { User: ['name'] }, app: { User: ['name'] } });
    expect(refusalFor(rename('User', 'name', 'fullName'), twice).message).toContain(
      'table "User" is declared in more than one namespace (auth, app); name its namespace',
    );
  });
});
