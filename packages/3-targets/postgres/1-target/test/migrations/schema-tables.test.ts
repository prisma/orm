import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresSchemaTables } from '../../src/core/migrations/schema-tables';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractOf } from './rename-table-fixtures';

describe('postgresSchemaTables', () => {
  const unbound = contractOf('userProfile', {}, 'unbound');
  const tables = postgresSchemaTables(
    postgresContractToSchema(unbound, postgresTypeComponents),
    unbound,
  );

  it('finds a table and its columns by the contract namespace id', () => {
    expect(tables.hasTable(UNBOUND_NAMESPACE_ID, 'userProfile')).toBe(true);
    expect(tables.hasColumn(UNBOUND_NAMESPACE_ID, 'userProfile', 'email')).toBe(true);
    expect(tables.hasColumn(UNBOUND_NAMESPACE_ID, 'userProfile', 'ghost')).toBe(false);
    expect(tables.columnsNamed(UNBOUND_NAMESPACE_ID, 'userProfile', 'email')).toEqual(['email']);
    expect(tables.columnsNamed(UNBOUND_NAMESPACE_ID, 'userProfile', 'EMAIL')).toEqual([]);
    expect(tables.hasTable(UNBOUND_NAMESPACE_ID, 'ghost')).toBe(false);
  });

  it('names the namespaces that have a table', () => {
    expect(tables.namespacesWithTable('userProfile')).toEqual([UNBOUND_NAMESPACE_ID]);
    expect(tables.namespacesWithTable('ghost')).toEqual([]);
  });

  it('maps a bound namespace id to its DDL schema', () => {
    const bound = contractOf('userProfile', {}, 'bound', () => ({}), 'auth');
    const authTables = postgresSchemaTables(
      postgresContractToSchema(bound, postgresTypeComponents),
      bound,
    );

    expect(authTables.hasTable('auth', 'userProfile')).toBe(true);
    expect(authTables.namespacesWithTable('userProfile')).toEqual(['auth']);
  });
});
