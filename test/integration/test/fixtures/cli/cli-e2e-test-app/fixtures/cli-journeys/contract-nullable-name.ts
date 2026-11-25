import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

/**
 * From-state for the nullable-tightening journey: `User.name` is
 * present but nullable. Pairs with `contract-nullable-name-required.ts`,
 * which flips it to NOT NULL and is the input to
 * `nullableTighteningCallStrategy`.
 */
export const contract = defineContract({
  databaseVersion: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        name: field.column(textColumn).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
