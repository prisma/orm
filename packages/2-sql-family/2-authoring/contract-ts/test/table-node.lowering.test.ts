import { describe, expect, it } from 'vitest';
import type { ForeignKeyNode, ModelNode, TableNode } from '../src/contract-definition';
import { build, columnIndex, definitionOf, field } from './table-node-helpers';

const id = field('id');

const user: ModelNode = {
  modelName: 'User',
  tableName: 'User',
  fields: [id],
  id: { columns: ['id'] },
};

const auditForeignKeys: readonly ForeignKeyNode[] = [
  { columns: ['userId'], references: { table: 'User', columns: ['id'] }, index: true },
  { columns: ['actorId'], references: { table: 'User', columns: ['id'] }, index: true },
];

const auditColumns = [
  field('id'),
  field('userId'),
  field('actorId'),
  field('recordedAt', 'pg/timestamptz@1'),
];

const auditColumnNodes = auditColumns.map(({ fieldName: _f, ...column }) => column);

const auditTable: TableNode = {
  tableName: 'audit_rows',
  columns: auditColumnNodes,
  id: { columns: ['id'] },
  indexes: [columnIndex(['recordedAt'])],
  foreignKeys: auditForeignKeys,
};

const auditModel: ModelNode = {
  modelName: 'AuditRow',
  tableName: 'audit_rows',
  fields: auditColumns,
  id: { columns: ['id'] },
  indexes: [columnIndex(['recordedAt'])],
  foreignKeys: auditForeignKeys.map((fk) => ({
    ...fk,
    references: { model: 'User', ...fk.references },
  })),
};

function post(target: ForeignKeyNode['references']): ModelNode {
  return {
    modelName: 'Post',
    tableName: 'Post',
    fields: [id, field('auditId')],
    id: { columns: ['id'] },
    foreignKeys: [{ columns: ['auditId'], references: target, index: true }],
  };
}

describe('a table node for a table no model maps', () => {
  const withTableNode = build(
    definitionOf([user, post({ table: 'audit_rows', columns: ['id'] })], { tables: [auditTable] }),
  );
  const withModel = build(
    definitionOf([
      user,
      post({ model: 'AuditRow', table: 'audit_rows', columns: ['id'] }),
      auditModel,
    ]),
  );

  it('lowers to the same storage as a model of that table, foreign keys in declaration order', () => {
    expect(withTableNode.storage).toStrictEqual(withModel.storage);
  });

  it('lowers its primary key, index, foreign keys and backing indexes, and is the target of a model foreign key', () => {
    const tables = withTableNode.storage.namespaces['public']?.entries.table;
    expect(tables?.['audit_rows']?.primaryKey).toEqual({ columns: ['id'] });
    expect(
      tables?.['audit_rows']?.foreignKeys.map((fk) => ({
        columns: fk.source.columns,
        table: fk.target.tableName,
      })),
    ).toEqual([
      { columns: ['userId'], table: 'User' },
      { columns: ['actorId'], table: 'User' },
    ]);
    expect(tables?.['audit_rows']?.indexes.map((index) => index.columns)).toEqual([
      ['recordedAt'],
      ['userId'],
      ['actorId'],
    ]);
    expect(tables?.['Post']?.foreignKeys.map((fk) => fk.target.tableName)).toEqual(['audit_rows']);
  });

  it('has no model and no root', () => {
    expect(Object.keys(withTableNode.domain.namespaces['public']?.models ?? {})).toEqual([
      'User',
      'Post',
    ]);
    expect(Object.keys(withTableNode.roots)).toEqual(['User', 'Post']);
  });

  it('lives in the namespace it names', () => {
    const contract = build(
      definitionOf([user], {
        tables: [{ namespaceId: 'audit', tableName: 'audit_rows', columns: auditColumnNodes }],
      }),
    );
    expect(Object.keys(contract.storage.namespaces['audit']?.entries.table ?? {})).toEqual([
      'audit_rows',
    ]);
  });
});
