import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

/**
 * Type-change *to*-state: the `score` column, previously `text`
 * (`contract-typechange-text.ts`), is retyped as `int4`. The
 * `text → int4` transition is unsafe (not in `SAFE_WIDENINGS`): without a
 * statement `migration plan` asks about it, and with `--convert User.score`
 * the Postgres `typeChangeCallStrategy` emits one `alterColumnType` whose
 * `using` is a placeholder the user fills with the conversion.
 */
export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        score: field.column(int4Column),
      },
    }).sql({ table: 'user' }),
  },
});
