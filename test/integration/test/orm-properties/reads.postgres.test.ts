import { describe, it } from 'vitest';
import { expectExercised, Tally } from './capabilities';
import { onEachSchema } from './each-schema';
import { withPostgresServer } from './postgres-database';
import { exercisedByReads, readsAgree } from './reads';

describe('Postgres ORM reads', { timeout: 900_000 }, () => {
  it('agree with the same rows read another way, on generated schemas', async () => {
    const tally = new Tally();
    await withPostgresServer(async (withDatabase) => {
      await onEachSchema('postgres', 6, async ({ schema, contractJson, seed }) => {
        await withDatabase(contractJson, schema.tables, ({ reference, clear }) =>
          readsAgree(reference, clear, { schema, runs: 8, seed, generatedKeys: false, tally }),
        );
      });
    });
    expectExercised(tally, exercisedByReads);
  });
});
