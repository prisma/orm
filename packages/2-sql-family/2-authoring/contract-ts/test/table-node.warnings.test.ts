import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnNode, ModelNode } from '../src/contract-definition';
import { build, definitionOf, field } from './table-node-helpers';

const user: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  fields: [field('id')],
  id: { columns: ['id'] },
};

const legacyKey: ColumnNode = {
  columnName: 'legacy_key',
  descriptor: { codecId: 'pg/text@1' },
  nullable: false,
};

function warningsFor(columns: readonly ColumnNode[], tableName = 'users'): unknown[][] {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  build(definitionOf([user], { tables: [{ tableName, columns }] }));
  return emitWarning.mock.calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a required column no field maps', () => {
  it('warns on a table a model maps, because every ORM insert into it fails', () => {
    expect(warningsFor([legacyKey])).toEqual([
      [
        'Column "legacy_key" of table "users" is required and has no default, and no field of model "User" maps it, so every insert the ORM makes into the table fails. Make the column nullable, give it a database default, or map it with a field.',
        { code: 'PN_COLUMN_REQUIRED_UNMAPPED' },
      ],
    ]);
  });

  it('does not warn when the column is nullable', () => {
    expect(warningsFor([{ ...legacyKey, nullable: true }])).toEqual([]);
  });

  it('does not warn when the column has a default', () => {
    expect(
      warningsFor([{ ...legacyKey, default: { kind: 'function', expression: "'none'" } }]),
    ).toEqual([]);
  });

  it('does not warn on a table no model maps', () => {
    expect(warningsFor([field('id'), legacyKey], 'audit_rows')).toEqual([]);
  });
});
