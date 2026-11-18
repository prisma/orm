import type { DatabasePolicies } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { runnerOptionsFor } from './run-migration-harness';

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

describe('runMigration, database policies', () => {
  it('hands the application space the policies to record', async () => {
    const [app] = await runnerOptionsFor(MIGRATE_ONLY);
    expect({ space: app?.space, databasePolicies: app?.databasePolicies }).toEqual({
      space: 'app',
      databasePolicies: MIGRATE_ONLY,
    });
  });

  it('hands the runner no policies when the run records none', async () => {
    const [app] = await runnerOptionsFor(undefined);
    expect(app).not.toHaveProperty('databasePolicies');
  });
});
