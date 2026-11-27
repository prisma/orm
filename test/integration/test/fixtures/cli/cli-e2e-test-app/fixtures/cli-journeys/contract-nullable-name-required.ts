import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
} from '@internal/postgres/contract-builder';

/**
 * To-state for the nullable-tightening journey: `User.name`,
 * previously nullable (`contract-nullable-name.ts`), is now NOT NULL.
 * The Postgres `nullableTighteningCallStrategy` matches this case and
 * emits `dataTransform(placeholder slots) → setNotNull` so the user
 * can backfill any existing NULL rows before the constraint is
 * tightened.
 */
export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
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
