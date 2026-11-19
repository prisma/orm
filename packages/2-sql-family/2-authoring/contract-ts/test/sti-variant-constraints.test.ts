import { describe, expect, it } from 'vitest';
import type { ForeignKeyNode, IndexNode, ModelNode } from '../src/contract-definition';
import { build, columnIndex, definitionOf, field } from './table-node-helpers';

const contact: ModelNode = {
  modelName: 'Contact',
  tableName: 'contact',
  fields: [field('id')],
  id: { columns: ['id'] },
};

const toContact: ForeignKeyNode = {
  columns: ['contactId'],
  references: { model: 'Contact', table: 'contact', columns: ['id'] },
  onDelete: 'cascade',
};

const scopedIndex: IndexNode = { ...columnIndex(['contactId']), where: "kind = 'bug'" };

const task = (constraints: Partial<ModelNode> = {}): ModelNode => ({
  modelName: 'Task',
  tableName: 'task',
  fields: [
    field('id'),
    field('kind', 'pg/text@1'),
    field('contactId', 'pg/int4@1', { nullable: true }),
  ],
  id: { columns: ['id'] },
  ...constraints,
});

const bug = (constraints: Partial<ModelNode> = {}): ModelNode => ({
  modelName: 'Bug',
  tableName: 'task',
  sharesBaseTable: true,
  fields: [field('contactId', 'pg/int4@1', { nullable: true })],
  ...constraints,
});

function taskTable(models: readonly ModelNode[]) {
  return build(definitionOf(models)).storage.namespaces['public']?.entries.table?.['task'];
}

describe('constraints declared on a single-table variant', () => {
  it("stores the variant's foreign key and scoped index as if the base model declared them", () => {
    expect(
      taskTable([contact, task(), bug({ foreignKeys: [toContact], indexes: [scopedIndex] })]),
    ).toEqual(taskTable([contact, task({ foreignKeys: [toContact], indexes: [scopedIndex] })]));
  });

  it('refuses a unique on the variant', () => {
    expect(() =>
      build(definitionOf([contact, task(), bug({ uniques: [{ columns: ['contactId'] }] })])),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ modelName: 'Bug', unscoped: [['contactId']] }),
      }),
    );
  });
});
