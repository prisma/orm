import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';
import { SqliteDatabase } from '../src/core/sqlite-unbound-database';

function makeContractWithTablesJson() {
  return createSqlContract({
    target: 'sqlite',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
  });
}

describe('SqliteContractSerializer namespace hydration', () => {
  it('materialises table-bearing unbound namespaces with qualifyTable()', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const namespace = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!;
    expect(namespace).toBeInstanceOf(SqliteDatabase);
    if (!(namespace instanceof SqliteDatabase)) {
      return;
    }
    expect(namespace.qualifyTable('user')).toBe('"user"');
    const userTable = namespace.table['user'];
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
  });
});
