import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

/**
 * Adds a NOT NULL `name` column with no default to `User`. The Postgres
 * issue-planner's `notNullBackfillCallStrategy` matches this case and
 * emits `addColumn(nullable) → DataTransformCall(placeholder slots) →
 * setNotNull`, so a test driving `migration plan` against this contract
 * gets a `placeholder()`-stubbed `migration.ts` to fill in.
 */
export const contract = defineContract({
  version: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        name: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
