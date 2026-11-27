import { APP_SPACE_ID, PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from '../helpers/test-control-adapter';
import {
  releaseCandidatePrismaTables,
  releaseCandidateRows,
} from './fixtures/release-candidate-prisma-tables';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  testTimeout,
} from './fixtures/runner-fixtures';

const earlierRelease = expect.objectContaining({
  code: 'CONTRACT.PRISMA_TABLES_FROM_EARLIER_RELEASE',
  message: "Prisma's own tables in this database were written by an earlier release of Prisma",
  fix: expect.stringContaining('`{bin} db migrate'),
});

describe('reading Prisma tables an earlier release wrote', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;
  const adapter = createTestPostgresControlAdapter();

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  beforeEach(async () => {
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('drop schema if exists _prisma cascade');
  }, testTimeout);

  async function createReleaseCandidateTables(): Promise<void> {
    for (const statement of [...releaseCandidatePrismaTables, ...releaseCandidateRows]) {
      await driver.query(statement);
    }
  }

  describe('on a database a release candidate set up', () => {
    beforeEach(createReleaseCandidateTables, testTimeout);

    it('refuses to read every marker row', { timeout: testTimeout }, async () => {
      await expect(familyInstance.readAllMarkers({ driver })).rejects.toEqual(earlierRelease);
    });

    it("refuses to read a space's marker row", { timeout: testTimeout }, async () => {
      await expect(familyInstance.readMarker({ driver, space: APP_SPACE_ID })).rejects.toEqual(
        earlierRelease,
      );
    });

    it('refuses to read the ledger', { timeout: testTimeout }, async () => {
      await expect(familyInstance.readLedger({ driver })).rejects.toEqual(earlierRelease);
      await expect(familyInstance.readLedger({ driver, space: APP_SPACE_ID })).rejects.toEqual(
        earlierRelease,
      );
    });

    it('reads no row and no ledger entry for the _prisma space, which no earlier release wrote', {
      timeout: testTimeout,
    }, async () => {
      expect({
        marker: await familyInstance.readMarker({ driver, space: PRISMA_SPACE_ID }),
        ledger: await familyInstance.readLedger({ driver, space: PRISMA_SPACE_ID }),
        read: await adapter.readMarkerDiscriminated(driver, PRISMA_SPACE_ID),
      }).toEqual({ marker: null, ledger: [], read: { kind: 'no-table' } });
    });

    it("tells the runtime's marker check the tables are in an earlier release's form", {
      timeout: testTimeout,
    }, async () => {
      expect(await adapter.readMarkerDiscriminated(driver, APP_SPACE_ID)).toEqual({
        kind: 'earlier-release',
      });
    });
  });

  it('reads an empty database as having no rows', { timeout: testTimeout }, async () => {
    expect({
      markers: await familyInstance.readAllMarkers({ driver }),
      marker: await familyInstance.readMarker({ driver, space: APP_SPACE_ID }),
      ledger: await familyInstance.readLedger({ driver }),
      read: await adapter.readMarkerDiscriminated(driver, APP_SPACE_ID),
    }).toEqual({ markers: new Map(), marker: null, ledger: [], read: { kind: 'no-table' } });
  });
});
