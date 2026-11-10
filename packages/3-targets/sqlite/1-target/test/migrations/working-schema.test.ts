import type { SchemaNodeRef } from '@internal/framework-components/control';
import {
  RelationalSchemaNodeKind,
  type SqlSchemaIR,
  type SqlTableIR,
} from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import {
  CreateIndexCall,
  DropIndexCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createWorkingSchema,
  renameTableInSqliteSchema,
} from '../../src/core/migrations/working-schema';
import { sqliteTestTypes } from '../sqlite-test-types';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  reference,
} from './rename-table-fixtures';

const withObjects: ProfileSpec = {
  uniques: [{ columns: ['email'] }],
  foreignKeys: (tableName) => [
    { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
    { source: reference(tableName, ['accountId']), target: reference(tableName, ['id']) },
  ],
  indexes: (tableName) => [handleIndex(tableName)],
};

function startSchema(): SqlSchemaIR {
  return sqliteContractToSchema(contractOf('userProfile', withObjects, 'from'), sqliteTestTypes);
}

function tableIn(schema: SqlSchemaIR, table: string): SqlTableIR {
  const found = schema.tables[table];
  if (found === undefined) throw new Error(`table ${table} missing`);
  return found;
}

const tableStepsOf = (refs: readonly SchemaNodeRef[] | undefined) =>
  (refs ?? []).map((ref) => ref[1]);

const RENAME = { from: 'userProfile', to: 'UserProfile' } as const;
const OLD_INDEX = `userProfile_handle_idx_${HANDLE_INDEX_HASH}`;
const NEW_INDEX = `UserProfile_handle_idx_${HANDLE_INDEX_HASH}`;

describe('renameTableInSqliteSchema', () => {
  it('re-keys and renames the table and leaves the input untouched', () => {
    const before = startSchema();
    const after = renameTableInSqliteSchema(before, RENAME);

    expect(Object.keys(after.tables).sort()).toEqual(['UserProfile', 'account', 'post']);
    expect(tableIn(after, 'UserProfile').name).toBe('UserProfile');
    expect(Object.keys(tableIn(after, 'UserProfile').columns)).toEqual(
      Object.keys(tableIn(before, 'userProfile').columns),
    );
    expect(Object.keys(before.tables).sort()).toEqual(['account', 'post', 'userProfile']);
  });

  it('retargets the foreign keys that reference the table, on other tables and on itself', () => {
    const after = renameTableInSqliteSchema(startSchema(), RENAME);

    expect(tableIn(after, 'post').foreignKeys.map((fk) => fk.referencedTable)).toEqual([
      'UserProfile',
    ]);
    expect(tableIn(after, 'UserProfile').foreignKeys.map((fk) => fk.referencedTable)).toEqual([
      'account',
      'UserProfile',
    ]);
    expect(tableStepsOf(tableIn(after, 'post').foreignKeys[0]?.dependsOn)).toEqual([
      { nodeKind: RelationalSchemaNodeKind.table, id: 'UserProfile' },
      { nodeKind: RelationalSchemaNodeKind.table, id: 'post' },
    ]);
  });

  it('keeps every object name, and leaves unnamed constraints unnamed as SQLite does', () => {
    const before = tableIn(startSchema(), 'userProfile');
    const after = tableIn(renameTableInSqliteSchema(startSchema(), RENAME), 'UserProfile');

    expect(after.indexes.map((index) => index.name)).toEqual([OLD_INDEX]);
    expect(after.primaryKey?.name).toBe(before.primaryKey?.name);
    expect(after.uniques.map((unique) => unique.name)).toEqual([undefined]);
    expect(after.foreignKeys.map((fk) => fk.name)).toEqual([undefined, undefined]);
  });

  it('moves the dependencies of the objects on the table to its new name', () => {
    const after = tableIn(renameTableInSqliteSchema(startSchema(), RENAME), 'UserProfile');
    const renamedStep = { nodeKind: RelationalSchemaNodeKind.table, id: 'UserProfile' };

    expect(tableStepsOf(after.primaryKey?.dependsOn)).toEqual([renamedStep]);
    expect(tableStepsOf(after.uniques[0]?.dependsOn)).toEqual([renamedStep]);
    expect(tableStepsOf(after.indexes[0]?.dependsOn)).toEqual([renamedStep]);
  });
});

describe('WorkingSchema.apply', () => {
  it('renames the table and then renames each index the companions replace, keeping its definition', () => {
    const working = createWorkingSchema(startSchema());
    working.apply(
      new RenameTableCall('userProfile', 'UserProfile', [
        {
          drop: new DropIndexCall('UserProfile', OLD_INDEX),
          create: new CreateIndexCall('UserProfile', NEW_INDEX, ['handle']),
        },
      ]),
    );

    const table = tableIn(working.current, 'UserProfile');
    expect(table.indexes.map((index) => [index.name, index.prefix, index.columns])).toEqual([
      [NEW_INDEX, 'UserProfile_handle_idx', ['handle']],
    ]);
    expect(working.current.tables['userProfile']).toBeUndefined();
  });

  it('replaces current with a new tree and never changes the one it replaced', () => {
    const initial = startSchema();
    const working = createWorkingSchema(initial);
    working.apply(new RenameTableCall('userProfile', 'UserProfile', []));

    expect(working.current).not.toBe(initial);
    expect(Object.keys(initial.tables)).toContain('userProfile');
    expect(Object.keys(working.current.tables)).toContain('UserProfile');
  });
});
