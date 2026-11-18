import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

describe('a convenience type helper', () => {
  it('refuses a precision its chosen type refuses, naming the argument of the convenience type', () => {
    expect(() =>
      defineContract({}, ({ type, field, model, gen }) => ({
        models: {
          Order: model('Order', {
            fields: {
              id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
              at: field.column(type.DateTime({ precision: 7 })),
            },
          }),
        },
      })),
    ).toThrow('Argument "precision" of DateTime is invalid: precision must be at most 6 (was 7)');
  });
});
