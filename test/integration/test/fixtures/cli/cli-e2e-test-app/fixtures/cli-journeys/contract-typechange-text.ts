import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

/**
 * Type-change *from*-state: a `score` column typed as `text`. Pairs with
 * `contract-typechange-int.ts` to drive an unsafe `text → int4` change
 * through the Postgres planner's `typeChangeCallStrategy`.
 */
export const contract = defineContract({
  databaseVersion: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        score: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
