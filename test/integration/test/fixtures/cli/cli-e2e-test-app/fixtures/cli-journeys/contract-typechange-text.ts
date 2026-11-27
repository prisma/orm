import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
} from '@internal/postgres/contract-builder';

/**
 * Type-change *from*-state: a `score` column typed as `text`. Pairs with
 * `contract-typechange-int.ts` to drive an unsafe `text → int4` change
 * through the Postgres planner's `typeChangeCallStrategy`.
 */
export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
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
