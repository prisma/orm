import { describe, expect, it } from 'vitest';
import type { ColumnNode, ModelNode, TableNode } from '../src/contract-definition';
import { build, columnIndex, definitionOf, field } from './table-node-helpers';

const user: ModelNode = {
  modelName: 'User',
  tableName: 'User',
  fields: [field('id'), field('email', 'pg/text@1')],
  id: { columns: ['id'] },
};

const legacyKey: ColumnNode = {
  columnName: 'legacy_key',
  descriptor: { codecId: 'pg/text@1' },
  nullable: true,
};

const idColumn: ColumnNode = {
  columnName: 'id',
  descriptor: { codecId: 'pg/int4@1' },
  nullable: false,
};

describe('table node refusals', () => {
  it('refuses a column node for a column a field of the same table maps', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [{ tableName: 'User', columns: [{ ...legacyKey, columnName: 'email' }] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message:
          'Column "email" of table "User" is declared by field "User.email" and again by a table node.',
        meta: { kind: 'column', name: 'email', tableName: 'User', namespaceId: 'public' },
      }),
    );
  });

  it('refuses two column nodes for one column', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [{ tableName: 'audit_rows', columns: [idColumn, idColumn] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message: 'Column "id" of table "audit_rows" is declared by two table nodes.',
        meta: { kind: 'column', name: 'id', tableName: 'audit_rows', namespaceId: 'public' },
      }),
    );
  });

  const tableLevelProperties: ReadonlyArray<readonly [string, Partial<TableNode>]> = [
    ['id', { id: { columns: ['legacy_key'] } }],
    ['uniques', { uniques: [{ columns: ['legacy_key'] }] }],
    [
      'indexes',
      {
        indexes: [columnIndex(['legacy_key'])],
      },
    ],
    [
      'checks',
      { checks: [{ expression: "legacy_key <> ''", name: 'legacy_present', map: undefined }] },
    ],
    [
      'foreignKeys',
      {
        foreignKeys: [{ columns: ['legacy_key'], references: { table: 'User', columns: ['id'] } }],
      },
    ],
    ['control', { control: 'external' }],
  ];

  it.each(tableLevelProperties)(
    'refuses a table node that states %s for a table a model maps',
    (property, extra) => {
      expect(() =>
        build(
          definitionOf([user], { tables: [{ tableName: 'User', columns: [legacyKey], ...extra }] }),
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.TABLE_OWNED_BY_MODEL',
          message: `A table node for table "User" states ${property}, but model "User" maps that table and owns its table-level properties. A table node for a modelled table may only add columns.`,
          meta: { namespaceId: 'public', tableName: 'User', modelName: 'User', property },
        }),
      );
    },
  );

  it('refuses two table nodes for one table in one namespace', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [
            { tableName: 'audit_rows', columns: [idColumn] },
            { tableName: 'audit_rows', columns: [legacyKey] },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message: 'Table "audit_rows" in namespace "public" is declared by two table nodes.',
        meta: { kind: 'table', name: 'audit_rows', namespaceId: 'public' },
      }),
    );
  });

  it('accepts table nodes for tables of one name in two namespaces', () => {
    const contract = build(
      definitionOf([user], {
        tables: [
          { tableName: 'audit_rows', columns: [idColumn] },
          { namespaceId: 'audit', tableName: 'audit_rows', columns: [idColumn] },
        ],
      }),
    );
    expect(contract.storage.namespaces['audit']?.entries.table?.['audit_rows']).toBeDefined();
    expect(contract.storage.namespaces['public']?.entries.table?.['audit_rows']).toBeDefined();
  });

  it('refuses a foreign key to a table no model or table node declares', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [
            {
              tableName: 'audit_rows',
              columns: [idColumn],
              foreignKeys: [{ columns: ['id'], references: { table: 'Ghost', columns: ['id'] } }],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TABLE_UNKNOWN',
        message:
          'Foreign key on table "audit_rows" references table "Ghost" in namespace "public", which no model or table node declares',
        meta: { sourceTable: 'audit_rows', referencedTable: 'Ghost', namespaceId: 'public' },
      }),
    );
  });

  it('names the table that owns a foreign key to an unknown model', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [
            {
              tableName: 'audit_rows',
              columns: [idColumn],
              foreignKeys: [
                {
                  columns: ['id'],
                  references: { model: 'Ghost', table: 'ghost', columns: ['id'] },
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        message: 'Foreign key on table "audit_rows" references unknown model "Ghost"',
        meta: { sourceTable: 'audit_rows', targetModel: 'Ghost', context: 'Foreign key' },
      }),
    );
  });

  it('adds a column node for a single-table variant table to the base model table, since only a table can be named', () => {
    const contract = build(
      definitionOf(
        [
          { modelName: 'Task', tableName: 'task', fields: [field('id')], id: { columns: ['id'] } },
          { modelName: 'Bug', tableName: 'task', sharesBaseTable: true, fields: [] },
        ],
        { tables: [{ tableName: 'task', columns: [legacyKey] }] },
      ),
    );
    expect(
      Object.keys(contract.storage.namespaces['public']?.entries.table?.['task']?.columns ?? {}),
    ).toEqual(['id', 'legacy_key']);
  });
});
