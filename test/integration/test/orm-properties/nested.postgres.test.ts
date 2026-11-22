import { describe, it } from 'vitest';
import { expectExercised, Tally } from './capabilities';
import { onEachSchema } from './each-schema';
import { nestedEqualsSeparate } from './nested';
import { withPostgresServer } from './postgres-database';

describe('Postgres ORM nested writes', { timeout: 900_000 }, () => {
  it('store the same rows as the same writes made one call at a time, on generated schemas', async () => {
    const tally = new Tally();
    await withPostgresServer(async (withDatabase) => {
      await onEachSchema('postgres', 6, async ({ schema, contractJson, seed }) => {
        await withDatabase(contractJson, schema.tables, ({ reference, clear }) =>
          nestedEqualsSeparate(reference, clear, { schema, runs: 12, seed, tally }),
        );
      });
    });
    expectExercised(tally, ['create with nested writes', 'update with nested writes']);
  });
});
