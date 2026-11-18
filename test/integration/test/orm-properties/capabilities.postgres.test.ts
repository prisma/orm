import { describe, it } from 'vitest';
import { expectExercised, sameOnBothPaths, Tally } from './capabilities';
import { exercisedByEverySuite, onEachSchema } from './each-schema';
import { withPostgresServer } from './postgres-database';

describe('Postgres ORM calls with and without a capability', { timeout: 900_000 }, () => {
  it('return the same values and store the same rows, on generated schemas', async () => {
    const tally = new Tally();
    await withPostgresServer(async (withDatabase) => {
      await onEachSchema('postgres', 8, async ({ schema, contractJson, seed }) => {
        await withDatabase(contractJson, schema.tables, (paths) =>
          sameOnBothPaths(paths, { schema, runs: 12, seed, generatedKeys: false, tally }),
        );
      });
    });
    expectExercised(tally, exercisedByEverySuite);
  });
});
