import { describe, expect, it } from 'vitest';
import { createDevDatabase, timeouts } from '../src/exports/index';

describe('createDevDatabase', () => {
  it(
    'keeps idle connections at least as long as the Postgres driver pool does',
    async () => {
      const database = await createDevDatabase();
      try {
        expect(database.databaseIdleTimeoutMillis).toBeGreaterThanOrEqual(30_000);
      } finally {
        await database.close();
      }
    },
    timeouts.databaseOperation,
  );
});
