import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

describe('a scalar convenience type helper', () => {
  it('emits the contract its explicit type emits', () => {
    const convenience = defineContract({}, ({ type, field, model }) => ({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(type.Int()).id(),
            visits: field.column(type.Int({ storage: 'int2' })),
            balance: field.column(type.BigInt()),
            rank: field.column(type.BigInt({ as: 'number' })),
            huge: field.column(type.BigInt({ storage: 'numeric' })),
            price: field.column(type.Decimal({ precision: 10, scale: 2 })),
            name: field.column(type.String()),
            code: field.column(type.String({ storage: 'varchar', length: 12 })),
            ratio: field.column(type.Float()),
            small: field.column(type.Float({ storage: 'float4' })),
            active: field.column(type.Boolean()),
            avatar: field.column(type.Bytes()),
          },
        }),
      },
    }));
    const explicit = defineContract({}, ({ type, field, model }) => ({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(type.Int4()).id(),
            visits: field.column(type.Int2()),
            balance: field.column(type.Int8BigInt()),
            rank: field.column(type.Int8Number()),
            huge: field.column(type.NumericBigInt()),
            price: field.column(type.NumericString(10, 2)),
            name: field.column(type.Text()),
            code: field.column(type.Varchar(12)),
            ratio: field.column(type.Float8()),
            small: field.column(type.Float4()),
            active: field.column(type.Bool()),
            avatar: field.column(type.Bytea()),
          },
        }),
      },
    }));
    expect(JSON.stringify(convenience)).toBe(JSON.stringify(explicit));
  });

  it.each([
    [
      { storage: 'numeric', as: 'number' },
      'Argument "storage" of BigInt cannot be numeric with as: number; write one of: int8.',
    ],
  ])('refuses BigInt(%o) at its argument', (written, message) => {
    expect(() =>
      defineContract({}, ({ type }) => {
        type.BigInt(written as never);
        return { models: {} };
      }),
    ).toThrow(message);
  });

  it('refuses a length on String, whose default Text takes none', () => {
    expect(() =>
      defineContract({}, ({ type }) => {
        type.String({ length: 12 } as never);
        return { models: {} };
      }),
    ).toThrow(
      'Argument "length" of String does not apply to Text, the type that storage: text chooses.',
    );
  });
});
