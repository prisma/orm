import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { sqliteSchemaTables } from '../../src/core/migrations/schema-tables';
import { sqliteTestTypes } from '../sqlite-test-types';
import { contractOf } from './rename-table-fixtures';

describe('sqliteSchemaTables', () => {
  const tables = sqliteSchemaTables(
    sqliteContractToSchema(contractOf('userProfile', {}, 'from'), sqliteTestTypes),
  );

  it('finds a table and its columns whatever namespace id it is asked about', () => {
    expect(tables.hasTable(UNBOUND_NAMESPACE_ID, 'userProfile')).toBe(true);
    expect(tables.hasTable('any', 'userProfile')).toBe(true);
    expect(tables.hasColumn(UNBOUND_NAMESPACE_ID, 'userProfile', 'email')).toBe(true);
    expect(tables.hasColumn(UNBOUND_NAMESPACE_ID, 'userProfile', 'ghost')).toBe(false);
    expect(tables.hasTable(UNBOUND_NAMESPACE_ID, 'ghost')).toBe(false);
  });

  it('finds the columns SQLite takes for a name, whatever their case', () => {
    expect(tables.columnsNamed(UNBOUND_NAMESPACE_ID, 'userProfile', 'EMAIL')).toEqual(['email']);
    expect(tables.columnsNamed(UNBOUND_NAMESPACE_ID, 'userProfile', 'ghost')).toEqual([]);
  });

  it('names the unbound namespace for a table it has, and none otherwise', () => {
    expect(tables.namespacesWithTable('userProfile')).toEqual([UNBOUND_NAMESPACE_ID]);
    expect(tables.namespacesWithTable('ghost')).toEqual([]);
  });
});
