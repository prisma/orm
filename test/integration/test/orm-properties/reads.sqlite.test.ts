import { describe, it } from 'vitest';
import { expectExercised, Tally } from './capabilities';
import { onEachSchema } from './each-schema';
import { exercisedByReads, readsAgree } from './reads';
import { withSqliteDatabase } from './sqlite-database';

describe('SQLite ORM reads', { timeout: 900_000 }, () => {
  it('agree with the same rows read another way, on generated schemas', async () => {
    const tally = new Tally();
    await onEachSchema('sqlite', 16, async ({ schema, contractJson, seed }) => {
      await withSqliteDatabase(contractJson, schema.tables, ({ reference, clear }) =>
        readsAgree(reference, clear, { schema, runs: 20, seed, generatedKeys: true, tally }),
      );
    });
    expectExercised(tally, exercisedByReads);
  });
});
