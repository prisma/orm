import { describe, expect, it } from 'vitest';
import { keySchemas, keysWork } from './keys';
import { withSqliteDatabase } from './sqlite-database';

describe('SQLite scalar types with equality', { timeout: 600_000 }, () => {
  it('work as a primary key and a foreign key', async () => {
    for (const { types, tables, contractJson } of keySchemas('sqlite', 2)) {
      await withSqliteDatabase(contractJson, tables, async (paths) => {
        expect(await keysWork(paths, types, 15)).toEqual({
          withoutOrdering: ['Bytes', 'Json', 'DurationString'],
          withoutSeparateIncludes: ['Json'],
        });
      });
    }
  });
});
