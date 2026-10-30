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

  describe('updateMarker given the policies the caller checked', () => {
    const RECONCILE_FIRST = {
      change: ['reconcile', 'migrate'],
      dataProtection: {
        accessWidening: 'access-widening-with-consent',
        dataLoss: 'data-loss-with-consent',
      },
    };

    async function swapWithStored(
      meta: Record<string, unknown>,
      held: DatabasePolicies,
    ): Promise<boolean> {
      await controlAdapter.initMarker(driver, 'app', { storageHash: 'a1', profileHash: 'p' });
      await db
        .collection<{ _id: string }>('_prisma_migrations')
        .updateOne({ _id: 'app' }, { $set: { meta } });
      return controlAdapter.updateMarker(
        driver,
        'app',
        'a1',
        { storageHash: 'a2', profileHash: 'p' },
        held,
      );
    }

    it.each([
      ['the same settings', { policies: MIGRATE_ONLY }, MIGRATE_ONLY],
      [
        'the same settings in another field order',
        {
          policies: {
            dataProtection: {
              accessWidening: 'access-widening-forbidden',
              dataLoss: 'data-loss-forbidden',
            },
            change: ['migrate'],
          },
        },
        MIGRATE_ONLY,
      ],
      [
        'the same strategies in another array order',
        { policies: RECONCILE_FIRST },
        DEFAULT_DATABASE_POLICIES,
      ],
      ['no policies, when the defaults were checked', {}, DEFAULT_DATABASE_POLICIES],
      [
        'only the settings that differ from the defaults',
        { policies: { change: ['migrate'] } },
        { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
      ],
    ] as const)('swaps when the marker stores %s', async (_name, meta, held) => {
      expect(await swapWithStored(meta, held)).toBe(true);
    });

    it.each([
      ['other settings', { policies: MIGRATE_ONLY }, DEFAULT_DATABASE_POLICIES],
      ['no policies, when others were checked', {}, MIGRATE_ONLY],
      ['policies that are not an object', { policies: 'strict' }, DEFAULT_DATABASE_POLICIES],
      [
        'data protection that is not an object',
        { policies: { dataProtection: 'x' } },
        DEFAULT_DATABASE_POLICIES,
      ],
      [
        'a change that is not a list',
        { policies: { change: 'migrate' } },
        DEFAULT_DATABASE_POLICIES,
      ],
      [
        'a key the policies may not carry',
        { policies: { change: ['migrate', 'reconcile'], extra: 1 } },
        DEFAULT_DATABASE_POLICIES,
      ],
      [
        'a key data protection may not carry',
        { policies: { dataProtection: { extra: 1 } } },
        DEFAULT_DATABASE_POLICIES,
      ],
    ] as const)('does not swap when the marker stores %s', async (_name, meta, held) => {
      expect(await swapWithStored(meta, held)).toBe(false);
    });
  });
});
