import { numericColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

function storedDefault(value: string) {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Price: model('Price', {
        fields: {
          id: field.id.uuidv4String(),
          amount: field.column(numericColumn(10, 2)).default(value),
        },
      }),
    },
  }));
  return contract.storage.namespaces['public']?.entries.table?.['Price']?.columns.amount?.default;
}

describe('a numeric(10, 2) default written in the TypeScript builder', () => {
  it('is stored with as many fraction digits as the scale', () => {
    expect(storedDefault('1.5')).toEqual({ kind: 'literal', value: '1.50' });
  });

  it.each([
    ['a third fraction digit', '1.234'],
    ['more whole digits than the precision leaves', '123456789.5'],
  ])('is refused, not rounded, when it has %s', (_case, value) => {
    expect(() => storedDefault(value)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Price.amount" has a default that its codec refuses: pg/numeric JSON value must be a decimal string that numeric(10, 2) stores without rounding',
      }),
    );
  });
});
