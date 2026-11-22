import { describe, it } from 'vitest';
import { expectExercised, sameOnBothPaths, Tally } from './capabilities';
import { exercisedByEverySuite, exercisedWithManySequences, onEachSchema } from './each-schema';
import { scalarTypeNames } from './schemas';
import { withSqliteDatabase } from './sqlite-database';

describe('SQLite ORM calls with and without a capability', { timeout: 900_000 }, () => {
  it('return the same values and store the same rows, on generated schemas', async () => {
    const tally = new Tally();
    await onEachSchema('sqlite', 16, async ({ schema, contractJson, seed }) => {
      await withSqliteDatabase(contractJson, schema.tables, (paths) =>
        sameOnBothPaths(paths, { schema, runs: 30, seed, generatedKeys: true, tally }),
      );
    });
    expectExercised(tally, [
      ...scalarTypeNames('sqlite').map((name) => `stored ${name}`),
      ...exercisedByEverySuite,
      ...exercisedWithManySequences,
      'create depth 3',
      'create on generated key',
    ]);
  });
});
