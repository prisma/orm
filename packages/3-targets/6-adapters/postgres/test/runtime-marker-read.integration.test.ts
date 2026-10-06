import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { buildSignMarkerBootstrapQueries } from '@internal/target-postgres/contract-free';
import type { PostgresDdlNode } from '@internal/target-postgres/ddl';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

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

    const controlAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    for (const query of buildSignMarkerBootstrapQueries()) {
      await driver.execute(
        await controlAdapter.lowerToExecuteRequest(query as PostgresDdlNode, {
          contract: {} as PostgresContract,
        }),
      );
    }
    await driver.execute({
      sql: `insert into prisma_contract.marker
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
