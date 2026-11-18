import { describe, it } from 'vitest';
import { expectExercised, Tally } from './capabilities';
import { onEachSchema } from './each-schema';
import { exercisedByNestedWrites, nestedEqualsSeparate } from './nested';
import { withSqliteDatabase } from './sqlite-database';

describe('SQLite ORM nested writes', { timeout: 900_000 }, () => {
  it('store the same rows as the same writes made one call at a time, on generated schemas', async () => {
    const tally = new Tally();
    await onEachSchema('sqlite', 16, async ({ schema, contractJson, seed }) => {
      await withSqliteDatabase(contractJson, schema.tables, ({ reference, clear }) =>
        nestedEqualsSeparate(reference, clear, { schema, runs: 40, seed, tally }),
      );
    });
    expectExercised(tally, exercisedByNestedWrites);
  });
});
