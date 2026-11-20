import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import { emitFixture } from './emit';

const tenZero = {
  codecId: 'mysql/decimal@1',
  dataType: 'mysql/decimal',
  nullable: false,
  typeParams: { precision: 10, scale: 0 },
  default: { kind: 'literal', value: '12' },
};

function storageWith(args: readonly [] | readonly [number] | readonly [number, number]) {
  return JSON.parse(
    JSON.stringify(
      defineContract({}, ({ type, field, model }) => ({
        models: {
          Price: model('Price', {
            fields: {
              id: field.column(type.Int()).id(),
              v: field.column(type.NumericString(...args)).default('12.0'),
            },
          }),
        },
      })).storage,
    ),
  );
}

describe('NumericString on MariaDB without a precision or a scale', () => {
  it('emits from PSL as the decimal(10,0) the server makes, with its default as that column prints it', async () => {
    const { contractJson } = await emitFixture('numeric-string');
    expect(contractJson).toMatchObject({
      storage: {
        namespaces: {
          __unbound__: {
            entries: {
              table: {
                Price: {
                  columns: { bare: tenZero, ten: tenZero, tenZero: tenZero, decimal: tenZero },
                },
              },
            },
          },
        },
      },
    });
  });

  it('builds in TypeScript the storage and storage hash of NumericString(10, 0)', () => {
    const written = storageWith([10, 0]);
    expect(written.namespaces['__unbound__'].entries.table.Price.columns.v).toMatchObject(tenZero);
    expect([storageWith([]), storageWith([10])]).toEqual([written, written]);
  });
});
