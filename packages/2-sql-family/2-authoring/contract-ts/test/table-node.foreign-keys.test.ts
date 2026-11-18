import { describe, expect, it } from 'vitest';
import type { ColumnNode, ModelNode, TableNode } from '../src/contract-definition';
import { build, definitionOf, field } from './table-node-helpers';

const user: ModelNode = {
  modelName: 'User',
  tableName: 'User',
  fields: [field('id')],
  id: { columns: ['id'] },
};

const idColumn: ColumnNode = {
  columnName: 'id',
  descriptor: { codecId: 'pg/int4@1' },
  nullable: false,
};

const auditInAudit: TableNode = {
  namespaceId: 'audit',
  tableName: 'audit_rows',
  columns: [idColumn],
  id: { columns: ['id'] },
};

function referencing(references: { table: string; namespaceId?: string }): ModelNode {
  return {
    ...user,
    fields: [field('id'), field('auditId')],
    foreignKeys: [{ columns: ['auditId'], references: { ...references, columns: ['id'] } }],
  };
}

describe('a foreign key that names its target table', () => {
  it('resolves a table in the namespace it names', () => {
    const contract = build(
      definitionOf([referencing({ table: 'audit_rows', namespaceId: 'audit' })], {
        tables: [auditInAudit],
      }),
    );
    expect(
      contract.storage.namespaces['public']?.entries.table?.['User']?.foreignKeys.map(
        (fk) => fk.target,
      ),
    ).toEqual([{ namespaceId: 'audit', tableName: 'audit_rows', columns: ['id'] }]);
  });

  it('looks in the default namespace when it names none, not in the namespace of a table of that name', () => {
    expect(() =>
      build(definitionOf([referencing({ table: 'audit_rows' })], { tables: [auditInAudit] })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TABLE_UNKNOWN',
        message:
          'Foreign key on model "User" references table "audit_rows" in namespace "public", which no model or table node declares. Declare the table with a model or a table node, or correct the name.',
      }),
    );
  });

  it('looks in the default namespace when it names the empty namespace', () => {
    const contract = build(
      definitionOf([referencing({ table: 'audit_rows', namespaceId: '' })], {
        tables: [{ ...auditInAudit, namespaceId: '' }],
      }),
    );
    expect(
      contract.storage.namespaces['public']?.entries.table?.['User']?.foreignKeys.map(
        (fk) => fk.target.namespaceId,
      ),
    ).toEqual(['public']);
  });

  it('refuses a table no model or table node declares', () => {
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
          'Foreign key on table "audit_rows" in namespace "public" references table "Ghost" in namespace "public", which no model or table node declares. Declare the table with a model or a table node, or correct the name.',
        meta: {
          sourceTable: 'audit_rows',
          sourceNamespaceId: 'public',
          referencedTable: 'Ghost',
          namespaceId: 'public',
        },
      }),
    );
  });

  it('names the table node and its namespace when it names an unknown model', () => {
    expect(() =>
      build(
        definitionOf([user], {
          tables: [
            {
              namespaceId: 'audit',
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
        message:
          'Foreign key on table "audit_rows" in namespace "audit" references unknown model "Ghost"',
        meta: {
          sourceTable: 'audit_rows',
          sourceNamespaceId: 'audit',
          targetModel: 'Ghost',
          context: 'Foreign key',
        },
      }),
    );
  });
});

describe('a foreign key that names its target model', () => {
  it("targets the model's namespace when it names the empty namespace", () => {
    const auditRow: ModelNode = {
      modelName: 'AuditRow',
      tableName: 'audit_rows',
      namespaceId: 'audit',
      fields: [field('id')],
      id: { columns: ['id'] },
    };
    const owner: ModelNode = {
      ...user,
      fields: [field('id'), field('auditId')],
      foreignKeys: [
        {
          columns: ['auditId'],
          references: { model: 'AuditRow', table: 'audit_rows', namespaceId: '', columns: ['id'] },
        },
      ],
    };
    const contract = build(definitionOf([owner, auditRow]));
    expect(
      contract.storage.namespaces['public']?.entries.table?.['User']?.foreignKeys.map(
        (fk) => fk.target,
      ),
    ).toEqual([{ namespaceId: 'audit', tableName: 'audit_rows', columns: ['id'] }]);
  });
});
