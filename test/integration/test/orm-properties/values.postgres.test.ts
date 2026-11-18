import { describe, it } from 'vitest';
import { withPostgresServer } from './postgres-database';
import { probeTables, valueSchemas, valuesRoundTrip } from './values';

describe('Postgres values of every scalar type', { timeout: 600_000 }, () => {
  it('are returned as stored, stored again unchanged, read the same through an include and found by an equality filter', async () => {
    await withPostgresServer(async (withDatabase) => {
      for (const { types, contractJson } of valueSchemas('postgres', 2)) {
        await withDatabase(contractJson, probeTables, (paths) => valuesRoundTrip(paths, types, 15));
      }
    });
  });
});
