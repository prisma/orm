import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { FieldNode, ModelNode } from '../src/contract-definition';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

function intField(name: string): FieldNode {
  return {
    fieldName: name,
    columnName: name,
    descriptor: { codecId: 'pg/int4@1' },
    nullable: false,
    many: false,
  };
}

function item(namespaceId: string | undefined): ModelNode {
  return {
    modelName: 'Item',
    tableName: 'item',
    ...(namespaceId !== undefined ? { namespaceId } : {}),
    fields: [intField('id')],
    id: { columns: ['id'] },
  };
}

const order: ModelNode = {
  modelName: 'Order',
  tableName: 'order',
  fields: [intField('id'), intField('itemId')],
  id: { columns: ['id'] },
  relations: [
    {
      fieldName: 'item',
      toModel: 'Item',
      toTable: 'item',
      cardinality: 'N:1',
      nullable: false,
      on: {
        parentTable: 'order',
        parentColumns: ['itemId'],
        childTable: 'item',
        childColumns: ['id'],
      },
    },
  ],
};

describe('relation target namespace', () => {
  it('is the namespace of the model the relation resolves to, whatever other model shares its name', () => {
    const contract = buildSqlContractFromDefinition(
      {
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        namespaces: ['audit'],
        models: [item('audit'), order, item(undefined)],
      },
      testTypeLookups.codecLookup,
      testTypeLookups.dataTypeLookup,
    );

    expect(contract.domain.namespaces['public']?.models['Order']?.relations['item']).toEqual({
      to: { model: 'Item', namespace: 'public' },
      cardinality: 'N:1',
      nullable: false,
      on: { localFields: ['itemId'], targetFields: ['id'] },
    });
  });
});
