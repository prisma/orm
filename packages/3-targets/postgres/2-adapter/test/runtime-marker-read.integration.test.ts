import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import type { SqlQueryable } from '@internal/sql-relational-core/ast';
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

  async function connectWithSignature() {
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
      sql: `insert into _prisma.signatures (space, core_hash, profile_hash, invariants, signed_at)
       values ('app', 'core', 'profile', '{inv-1}'::text[], '2026-11-01T00:00:00Z')`,
    });
    return driver;
  }

  it(
    "reads the application space's row of _prisma.signatures",
    async () => {
      const driver = await connectWithSignature();

      const result = await createPostgresAdapter().profile.readMarker(driver);

      expect(result).toEqual({
        kind: 'present',
        record: {
          storageHash: 'core',
          profileHash: 'profile',
          contractJson: null,
          canonicalVersion: null,
          updatedAt: new Date('2026-11-01T00:00:00Z'),
          appTag: null,
          meta: {},
          invariants: ['inv-1'],
        },
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reads the signature as a role that may read _prisma.signatures and nothing else of Prisma',
    async () => {
      const database = await createDevDatabase();
      const driver = await createDriver(database.connectionString);
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });
      await createPrismaTables(driver);
      await driver.query(
        `insert into _prisma.signatures (space, core_hash, profile_hash, invariants)
         values ('app', 'core', 'profile', '{}'::text[])`,
      );
      await driver.query('create role signatures_reader nologin');
      await driver.query('grant usage on schema _prisma to signatures_reader');
      await driver.query('grant select on _prisma.signatures to signatures_reader');
      await driver.query('set role signatures_reader');
      const queryable: SqlQueryable = {
        execute: async () => ({ affectedRows: 0 }),
        async *query<Row>(request: { sql: string; params?: readonly unknown[] }) {
          yield* (await driver.query<Row>(request.sql, request.params ?? [])).rows;
        },
      };

      const result = await createPostgresAdapter().profile.readMarker(queryable);

      expect(result).toMatchObject({
        kind: 'present',
        record: { storageHash: 'core', profileHash: 'profile', meta: {} },
      });
    },
    timeouts.spinUpPpgDev,
  );
});
