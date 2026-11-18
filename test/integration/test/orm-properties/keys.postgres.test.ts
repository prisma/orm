import { describe, expect, it } from 'vitest';
import { keySchemas, keysWork } from './keys';
import { withPostgresServer } from './postgres-database';

describe('Postgres scalar types with equality', { timeout: 900_000 }, () => {
  it('work as a primary key and a foreign key', async () => {
    await withPostgresServer(async (withDatabase) => {
      for (const { types, tables, contractJson } of keySchemas('postgres', 1)) {
        await withDatabase(contractJson, tables, async (paths) => {
          expect(await keysWork(paths, types, 6)).toEqual({
            withoutOrdering: ['Bytea', 'Jsonb'],
            withoutSeparateIncludes: ['Jsonb', 'IntervalParts'],
          });
        });
      }
    });
  });
});
