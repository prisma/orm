import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import { seedTestMarker } from '@internal/sql-runtime/test/utils';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import type { DevDatabase } from '@repo/test-utils';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): Contract<SqlStorage> {
  const contractObj = defineContract({
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  return {
    ...contractObj,
    extensions: {
      postgres: {
        version: '0.0.1',
      },
      pg: {},
    },
  };
}

describe('family instance signSpaces', () => {
  let database: DevDatabase | undefined;
  let connectionString: string | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    connectionString = database.connectionString;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  describe('new marker creation', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await bootstrapPostgresSignMarkerTables(client);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'creates new marker when none exists',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = new PostgresContractSerializer().deserializeContract(
          contract,
        ) as Contract<SqlStorage>;

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const signatures = await familyInstance.signSpaces({
            driver,
            spaces: [{ space: APP_SPACE_ID, contract: validatedContract, verifiedMarker: null }],
          });

          expect(signatures).toEqual([
            {
              status: 'created',
              space: APP_SPACE_ID,
              contract: {
                storageHash: validatedContract.storage.storageHash,
                profileHash: validatedContract.profileHash,
              },
            },
          ]);

          // Verify marker was written to database
          const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
          expect(marker).not.toBeNull();
          expect(marker?.storageHash).toBe(validatedContract.storage.storageHash);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('marker update', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await bootstrapPostgresSignMarkerTables(client);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
        // Write initial marker with different hash
        await seedTestMarker(client, {
          storageHash: 'old-hash',
          profileHash: 'old-profile-hash',
          contractJson: { target: 'postgres' },
          canonicalVersion: 1,
        });
      });
    }, timeouts.spinUpPpgDev);

    it(
      'updates marker when hashes differ',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = new PostgresContractSerializer().deserializeContract(
          contract,
        ) as Contract<SqlStorage>;

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const signatures = await familyInstance.signSpaces({
            driver,
            spaces: [
              {
                space: APP_SPACE_ID,
                contract: validatedContract,
                verifiedMarker: { storageHash: 'old-hash', profileHash: 'old-profile-hash' },
              },
            ],
          });

          expect(signatures).toEqual([
            {
              status: 'updated',
              space: APP_SPACE_ID,
              contract: {
                storageHash: validatedContract.storage.storageHash,
                profileHash: validatedContract.profileHash,
              },
              previous: { storageHash: 'old-hash', profileHash: 'old-profile-hash' },
            },
          ]);

          // Verify marker was updated in database
          const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
          expect(marker).not.toBeNull();
          expect(marker?.storageHash).toBe(validatedContract.storage.storageHash);
          expect(marker?.storageHash).not.toBe('old-hash');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'preserves existing invariants when re-signing',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withClient(connectionString, async (client) => {
          await client.query(
            `update prisma_contract.marker set invariants = $1::text[] where space = 'app'`,
            [['email-verified', 'phone-backfill']],
          );
        });

        const contract = createTestContract();
        const validatedContract = new PostgresContractSerializer().deserializeContract(
          contract,
        ) as Contract<SqlStorage>;

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          await familyInstance.signSpaces({
            driver,
            spaces: [
              {
                space: APP_SPACE_ID,
                contract: validatedContract,
                verifiedMarker: { storageHash: 'old-hash', profileHash: 'old-profile-hash' },
              },
            ],
          });

          const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
          expect(marker?.storageHash).toBe(validatedContract.storage.storageHash);
          expect(marker?.invariants).toEqual(['email-verified', 'phone-backfill']);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'leaves every marker as it was when a later marker write fails',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withClient(connectionString, async (client) => {
          await client.query(`
            create or replace function refuse_extension_marker() returns trigger as $$
            begin
              if new.space = 'ext' then
                raise exception 'marker write refused';
              end if;
              return new;
            end
            $$ language plpgsql
          `);
          await client.query(`
            create trigger refuse_extension_marker
            before insert or update on prisma_contract.marker
            for each row execute function refuse_extension_marker()
          `);
        });

        const validatedContract = new PostgresContractSerializer().deserializeContract(
          createTestContract(),
        ) as Contract<SqlStorage>;

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          await expect(
            familyInstance.signSpaces({
              driver,
              spaces: [
                {
                  space: APP_SPACE_ID,
                  contract: validatedContract,
                  verifiedMarker: { storageHash: 'old-hash', profileHash: 'old-profile-hash' },
                },
                { space: 'ext', contract: validatedContract, verifiedMarker: null },
              ],
            }),
          ).rejects.toThrow(/marker write refused/);

          const markers = await familyInstance.readAllMarkers({ driver });
          expect([...markers].map(([space, marker]) => [space, marker.storageHash])).toEqual([
            [APP_SPACE_ID, 'old-hash'],
          ]);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('idempotent behavior', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await bootstrapPostgresSignMarkerTables(client);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'no-op when marker already matches',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = new PostgresContractSerializer().deserializeContract(
          contract,
        ) as Contract<SqlStorage>;

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const [first] = await familyInstance.signSpaces({
            driver,
            spaces: [{ space: APP_SPACE_ID, contract: validatedContract, verifiedMarker: null }],
          });
          expect(first).toMatchObject({ status: 'created' });

          // Get the marker's updated_at timestamp
          const markerAfterFirst = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
          const firstUpdatedAt = markerAfterFirst?.updatedAt;

          const [second] = await familyInstance.signSpaces({
            driver,
            spaces: [
              {
                space: APP_SPACE_ID,
                contract: validatedContract,
                verifiedMarker: {
                  storageHash: validatedContract.storage.storageHash,
                  profileHash: validatedContract.profileHash,
                },
              },
            ],
          });
          expect(second).toMatchObject({ status: 'unchanged' });

          // Verify marker was not updated (updated_at should be the same)
          const markerAfterSecond = await familyInstance.readMarker({
            driver,
            space: APP_SPACE_ID,
          });
          expect(markerAfterSecond?.updatedAt).toEqual(firstUpdatedAt);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
