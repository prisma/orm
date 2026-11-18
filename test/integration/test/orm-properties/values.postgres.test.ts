import { describe, it } from 'vitest';
import { withPostgresServer } from './postgres-database';
import { valueSchemas, valuesRoundTrip } from './values';

describe('Postgres values of every scalar type', { timeout: 600_000 }, () => {
  it('are returned as stored, stored again unchanged, and found by an equality filter', async () => {
    await withPostgresServer(async (withDatabase) => {
      for (const { types, contractJson } of valueSchemas('postgres', 2)) {
        await withDatabase(contractJson, ['Probe'], (paths) => valuesRoundTrip(paths, types, 15));
      }
    });
  });
});
