import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import { createDriver, createPrismaTables } from './migrations/fixtures/runner-fixtures';

describe('runtime readMarker through the Postgres runtime driver', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  async function connectWithMarker(canonicalVersion: number | null) {
    const database = await createDevDatabase();
    const driver = postgresRuntimeDriverDescriptor.create();
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    await driver.connect({ kind: 'url', url: database.connectionString });

    const controlDriver = await createDriver(database.connectionString);
    try {
      await createPrismaTables(controlDriver);
    } finally {
      await controlDriver.close();
    }
    await driver.execute({
      sql: `insert into _prisma.marker
         (space, core_hash, profile_hash, contract_json, canonical_version, invariants, updated_at)
       values ('app', 'core', 'profile', null, $1, '{inv-1}'::text[], now())`,
      params: [canonicalVersion],
    });
    return driver;
  }

  it.each([1, null])(
    'reads canonical_version %s as the stored value',
    async (canonicalVersion) => {
      const driver = await connectWithMarker(canonicalVersion);

      const result = await createPostgresAdapter().profile.readMarker(driver);

      expect(result).toMatchObject({
        kind: 'present',
        record: {
          storageHash: 'core',
          profileHash: 'profile',
          canonicalVersion,
          invariants: ['inv-1'],
        },
      });
    },
    timeouts.spinUpPpgDev,
  );
});
