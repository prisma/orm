import { numericColumn, varcharColumn } from '@internal/adapter-postgres/column-types';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

function buildWithColumn(descriptor: ColumnTypeDescriptor) {
  return defineContract({}, ({ field, model }) => ({
    models: {
      Item: model('Item', {
        fields: { id: field.id.uuidv4String(), value: field.column(descriptor) },
      }),
    },
  }));
}

describe('column type parameters', () => {
  it.each([
    ['varcharColumn(0)', varcharColumn(0), 'pg/varchar', 'length'],
    ['numericColumn(2000)', numericColumn(2000), 'pg/numeric', 'precision'],
  ])('%s fails when the contract is built', (_, descriptor, dataType, parameter) => {
    expect(() => buildWithColumn(descriptor)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: { dataType, parameters: [parameter], modelName: 'Item', fieldName: 'value' },
      }),
    );
  });

  it('builds a column whose parameters its data type accepts', () => {
    expect(() => buildWithColumn(varcharColumn(255))).not.toThrow();
  });
});
