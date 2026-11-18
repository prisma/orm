import { describe, it } from 'vitest';
import { withSqliteDatabase } from './sqlite-database';
import { probeTables, valueSchemas, valuesRoundTrip } from './values';

describe('SQLite values of every scalar type', { timeout: 300_000 }, () => {
  it('are returned as stored, stored again unchanged, read the same through an include and found by an equality filter', async () => {
    for (const { types, contractJson } of valueSchemas('sqlite', 2)) {
      await withSqliteDatabase(contractJson, probeTables, (paths) =>
        valuesRoundTrip(paths, types, 40),
      );
    }
  });
});
