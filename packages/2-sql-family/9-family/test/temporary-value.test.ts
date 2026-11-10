import { StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { columnTakesTemporaryValue } from '../src/core/migrations/temporary-value';

const text = { dataType: 'test/text', codecId: 'test/text@1', nullable: false };
const role = {
  ...text,
  valueSet: {
    plane: 'storage',
    namespaceId: 'app',
    entityKind: 'valueSet',
    entityName: 'Role',
  } as const,
};

const user = new StorageTable({
  columns: { id: text, code: text, teamId: text, role, name: text },
  primaryKey: { columns: ['id'] },
  uniques: [{ columns: ['code'] }],
  indexes: [],
  foreignKeys: [
    {
      source: { namespaceId: 'app', tableName: 'User', columns: ['teamId'] },
      target: { namespaceId: 'app', tableName: 'Team', columns: ['id'] },
    },
  ],
});

describe('columnTakesTemporaryValue', () => {
  it('refuses a key, unique, foreign-key or value-set column, and allows any other', () => {
    expect(
      ['id', 'code', 'teamId', 'role', 'name'].map((column) =>
        columnTakesTemporaryValue(user, column),
      ),
    ).toEqual([false, false, false, false, true]);
  });
});
