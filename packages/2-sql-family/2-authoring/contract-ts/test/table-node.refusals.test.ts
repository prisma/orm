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

  it('refuses a table node that lists one column twice', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [{ tableName: 'audit_rows', columns: [idColumn, idColumn] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message: 'Column "id" of table "audit_rows" is listed twice by its table node.',
        meta: { kind: 'column', name: 'id', tableName: 'audit_rows', namespaceId: 'public' },
      }),
    );
  });

  const tableLevelProperties: ReadonlyArray<readonly [string, string, Partial<TableNode>]> = [
    ['id', 'a primary key', { id: { columns: ['legacy_key'] } }],
    ['uniques', 'unique constraints', { uniques: [{ columns: ['legacy_key'] }] }],
    [
      'indexes',
      'indexes',
      {
        indexes: [columnIndex(['legacy_key'])],
      },
    ],
    [
      'checks',
      'check constraints',
      { checks: [{ expression: "legacy_key <> ''", name: 'legacy_present', map: undefined }] },
    ],
    [
      'foreignKeys',
      'foreign keys',
      {
        foreignKeys: [{ columns: ['legacy_key'], references: { table: 'User', columns: ['id'] } }],
      },
    ],
    ['control', 'a control policy', { control: 'external' }],
  ];

  it.each(tableLevelProperties)(
    'refuses a table node that states %s for a table a model maps',
    (property, label, extra) => {
      expect(() =>
        build(
          definitionOf([user], { tables: [{ tableName: 'User', columns: [legacyKey], ...extra }] }),
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.TABLE_OWNED_BY_MODEL',
          message: `A table node for table "User" states ${label}, but model "User" maps that table and owns its table-level properties. A table node for a modelled table may only add columns.`,
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

  it('refuses a column node for a column a single-table variant field maps, naming the variant field', () => {
    expect(() =>
      build(
        definitionOf(
          [
            {
              modelName: 'Task',
              tableName: 'task',
              fields: [field('id')],
              id: { columns: ['id'] },
            },
            {
              modelName: 'Bug',
              tableName: 'task',
              sharesBaseTable: true,
              fields: [field('severity', 'pg/text@1')],
            },
          ],
          { tables: [{ tableName: 'task', columns: [{ ...legacyKey, columnName: 'severity' }] }] },
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message:
          'Column "severity" of table "task" is declared by field "Bug.severity" and again by a table node.',
        meta: { kind: 'column', name: 'severity', tableName: 'task', namespaceId: 'public' },
      }),
    );
  });

  it('names the variant field when the base table carries a copy of the variant column', () => {
    expect(() =>
      build(
        definitionOf(
          [
            {
              modelName: 'Task',
              tableName: 'task',
              fields: [field('id'), field('severity', 'pg/text@1', { nullable: true })],
              id: { columns: ['id'] },
            },
            {
              modelName: 'Bug',
              tableName: 'task',
              sharesBaseTable: true,
              fields: [field('severity', 'pg/text@1')],
            },
          ],
          { tables: [{ tableName: 'task', columns: [{ ...legacyKey, columnName: 'severity' }] }] },
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        message:
          'Column "severity" of table "task" is declared by field "Bug.severity" and again by a table node.',
      }),
    );
  });
});
