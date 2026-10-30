import { MongoControlDriver } from '@internal/driver-mongo/control';
import {
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
} from '@internal/framework-components/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoControlAdapterImpl } from '../src/exports/control';

const controlAdapter = new MongoControlAdapterImpl();

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let driver: MongoControlDriver;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db('marker_policies_test');
  driver = new MongoControlDriver(db, client);
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  await db.collection('_prisma_migrations').deleteMany({});
});

describe('database policies in the marker', { timeout: timeouts.databaseOperation }, () => {
  it('initMarker records them in meta.policies', async () => {
    await controlAdapter.initMarker(driver, 'app', {
      storageHash: 'a1',
      profileHash: 'p',
      databasePolicies: MIGRATE_ONLY,
    });

    expect((await controlAdapter.readMarker(driver, 'app'))?.meta).toEqual({
      policies: MIGRATE_ONLY,
    });
  });

  it('updateMarker without policies leaves meta as it was', async () => {
    await controlAdapter.initMarker(driver, 'app', {
      storageHash: 'a1',
      profileHash: 'p',
      databasePolicies: MIGRATE_ONLY,
    });

    await controlAdapter.updateMarker(driver, 'app', 'a1', {
      storageHash: 'a2',
      profileHash: 'p',
      invariants: ['inv'],
    });

    const marker = await controlAdapter.readMarker(driver, 'app');
    expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
      storageHash: 'a2',
      meta: { policies: MIGRATE_ONLY },
    });
  });

  it('updateMarker with policies replaces them and keeps other meta keys', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'app',
      space: 'app',
      storageHash: 'a1',
      profileHash: 'p',
      updatedAt: new Date(),
      meta: { policies: MIGRATE_ONLY, note: 'kept' },
      invariants: [],
    });

    const swapped = await controlAdapter.updateMarker(driver, 'app', 'a1', {
      storageHash: 'a2',
      profileHash: 'p',
      databasePolicies: DEFAULT_DATABASE_POLICIES,
    });

    expect({ swapped, meta: (await controlAdapter.readMarker(driver, 'app'))?.meta }).toEqual({
      swapped: true,
      meta: { policies: DEFAULT_DATABASE_POLICIES, note: 'kept' },
    });
  });

  it('updateMarker given the recorded policies swaps only while the marker still records them', async () => {
    await controlAdapter.initMarker(driver, 'app', {
      storageHash: 'a1',
      profileHash: 'p',
      databasePolicies: MIGRATE_ONLY,
    });
    const stored = (await controlAdapter.readMarker(driver, 'app'))?.meta['policies'];

    const whenNoneRecorded = await controlAdapter.updateMarker(
      driver,
      'app',
      'a1',
      { storageHash: 'a2', profileHash: 'p' },
      { value: undefined },
    );
    const whenUnchanged = await controlAdapter.updateMarker(
      driver,
      'app',
      'a1',
      { storageHash: 'a2', profileHash: 'p' },
      { value: stored },
    );

    expect({ whenNoneRecorded, whenUnchanged }).toEqual({
      whenNoneRecorded: false,
      whenUnchanged: true,
    });
  });
});
