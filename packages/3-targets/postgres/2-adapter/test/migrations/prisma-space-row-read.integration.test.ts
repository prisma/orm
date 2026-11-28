import { APP_SPACE_ID, PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createPrismaTables,
  createTestDatabase,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

const headHash = postgresTargetDescriptor.contractSpace?.headRef.hash;

/**
 * A later major of Prisma may add to `_prisma.signatures` and reshape or drop everything else of Prisma's own tables. Every release of Prisma 8 must still recognise the Prisma space's own row, so it reads that row through `space`, `core_hash`, `profile_hash` and `invariants` alone.
 */
describe("reading the Prisma space's own row from a database a later release changed", {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  beforeEach(async () => {
    await driver.query('drop schema if exists _prisma cascade');
    await createPrismaTables(driver);
    await driver.query(
      `insert into _prisma.signatures (space, core_hash, profile_hash, invariants)
       values ('app', 'app-hash', 'app-profile', '{}')`,
    );
    await driver.query('alter table _prisma.signatures drop column signed_at');
    await driver.query('drop table _prisma.config');
  }, testTimeout);

  it('finds the row by itself', { timeout: testTimeout }, async () => {
    const record = await controlAdapter.readMarker(driver, PRISMA_SPACE_ID);

    expect(record).toMatchObject({ storageHash: headHash, invariants: [] });
  });

  it('finds the row among every signature, and reads the application row as recording no policies', {
    timeout: testTimeout,
  }, async () => {
    const markers = await controlAdapter.readAllMarkers(driver);

    expect({
      spaces: [...markers.keys()].sort(),
      prisma: markers.get(PRISMA_SPACE_ID)?.storageHash,
      app: markers.get(APP_SPACE_ID)?.meta,
    }).toEqual({ spaces: [PRISMA_SPACE_ID, APP_SPACE_ID].sort(), prisma: headHash, app: {} });
  });
});
