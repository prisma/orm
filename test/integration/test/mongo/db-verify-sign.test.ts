import mongoAdapterDescriptor, { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';
import { MongoControlDriver } from '@internal/driver-mongo/control';

import { createMongoFamilyInstance, mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack, issueOutcome } from '@internal/framework-components/control';
import { MongoCollection, type MongoContract, MongoIndex } from '@internal/mongo-contract';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();

const baseContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: crossRef('User') },
  domain: applicationDomainOf({
    models: {
      User: {
        fields: {
          _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
          email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
        relations: {},
        storage: { collection: 'users' },
      },
    },
  }),
  storage: {
    namespaces: {
      __unbound__: {
        id: '__unbound__' as const,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {
            users: new MongoCollection({
              indexes: [
                new MongoIndex({ keys: [{ field: 'email', direction: 1 as const }], unique: true }),
              ],
            }),
          },
        },
      },
    },
    storageHash: coreHash('verify-test'),
  },
  capabilities: {},
  extensions: {},
  profileHash: profileHash('verify-test'),
  meta: {},
};

function createInstance() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapterDescriptor,
  });
  return createMongoFamilyInstance(stack);
}

describe('db verify + db sign for Mongo (end-to-end)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'verify_sign_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1 },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await db.dropDatabase();
  }, timeouts.databaseOperation);

  function makeDriver() {
    return new MongoControlDriver(db, client);
  }

  describe('verify (marker-only)', () => {
    it('returns CONTRACT.MARKER_MISSING when no marker exists', async () => {
      const instance = createInstance();
      const result = await instance.verify({
        driver: makeDriver(),
        contract: baseContract,
        expectedTargetId: 'mongo',
        contractPath: '/test/contract.json',
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('CONTRACT.MARKER_MISSING');
      expect(result.summary).toContain('missing');
    });

    it('returns ok when marker matches', async () => {
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: baseContract.storage.storageHash,
        profileHash: baseContract.profileHash,
      });

      const instance = createInstance();
      const result = await instance.verify({
        driver: makeDriver(),
        contract: baseContract,
        expectedTargetId: 'mongo',
        contractPath: '/test/contract.json',
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('matches');
    });

    it('returns CONTRACT.MARKER_MISMATCH when storage hash differs', async () => {
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: coreHash('old-hash'),
        profileHash: baseContract.profileHash,
      });

      const instance = createInstance();
      const result = await instance.verify({
        driver: makeDriver(),
        contract: baseContract,
        expectedTargetId: 'mongo',
        contractPath: '/test/contract.json',
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('CONTRACT.MARKER_MISMATCH');
    });

    it('returns CONTRACT.MARKER_MISMATCH when profile hash differs', async () => {
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: baseContract.storage.storageHash,
        profileHash: profileHash('old-profile'),
      });

      const instance = createInstance();
      const result = await instance.verify({
        driver: makeDriver(),
        contract: baseContract,
        expectedTargetId: 'mongo',
        contractPath: '/test/contract.json',
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('CONTRACT.MARKER_MISMATCH');
    });
  });

  describe('schemaVerify', () => {
    it('returns ok when schema matches contract', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const instance = createInstance();
      const driver = makeDriver();
      const schema = await instance.introspect({
        driver,
        contract: baseContract,
      });
      const result = instance.verifySchema({
        contract: baseContract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result).toMatchObject({
        ok: true,
        schema: { issues: [] },
      });
    });

    it('fails when expected index is missing', async () => {
      await db.createCollection('users');

      const instance = createInstance();
      const driver = makeDriver();
      const schema = await instance.introspect({
        driver,
        contract: baseContract,
      });
      const result = instance.verifySchema({
        contract: baseContract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(
        result.schema.issues.some(
          (i) => issueOutcome(i) === 'not-found' && i.path[1]?.startsWith('index:'),
        ),
      ).toBe(true);
    });

    it('passes on extra index in non-strict mode, with no extra-index finding in the result', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ createdAt: -1 });

      const instance = createInstance();
      const driver = makeDriver();
      const schema = await instance.introspect({
        driver,
        contract: baseContract,
      });
      const result = instance.verifySchema({
        contract: baseContract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(
        result.schema.issues.some(
          (i) => issueOutcome(i) === 'not-expected' && i.path[1]?.startsWith('index:'),
        ),
      ).toBe(false);
    });

    it('fails on extra index in strict mode', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ createdAt: -1 });

      const instance = createInstance();
      const driver = makeDriver();
      const schema = await instance.introspect({
        driver,
        contract: baseContract,
      });
      const result = instance.verifySchema({
        contract: baseContract,
        schema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(
        result.schema.issues.some(
          (i) => issueOutcome(i) === 'not-expected' && i.path[1]?.startsWith('index:'),
        ),
      ).toBe(true);
    });

    it('fails when expected collection is missing', async () => {
      const instance = createInstance();
      const driver = makeDriver();
      const schema = await instance.introspect({
        driver,
        contract: baseContract,
      });
      const result = instance.verifySchema({
        contract: baseContract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(
        result.schema.issues.some((i) => issueOutcome(i) === 'not-found' && i.path.length === 1),
      ).toBe(true);
    });
  });

  describe('signSpaces', () => {
    const baseMarker = {
      storageHash: baseContract.storage.storageHash,
      profileHash: baseContract.profileHash,
    };
    const signApp = (contract: MongoContract, verifiedMarker: typeof baseMarker | null) =>
      createInstance().signSpaces({
        driver: makeDriver(),
        spaces: [{ space: 'app', contract, verifiedMarker }],
      });
    const updatedContract: MongoContract = {
      ...baseContract,
      storage: {
        ...baseContract.storage,
        storageHash: coreHash('updated-contract'),
      },
    };

    it('creates marker on fresh database', async () => {
      expect(await signApp(baseContract, null)).toEqual([
        {
          space: 'app',
          contract: {
            storageHash: baseContract.storage.storageHash,
            profileHash: baseContract.profileHash,
          },
          status: 'created',
        },
      ]);
    });

    it('re-signing with same contract is idempotent', async () => {
      await signApp(baseContract, null);

      const [signature] = await signApp(baseContract, baseMarker);

      expect(signature).toMatchObject({ status: 'unchanged' });
    });

    it('updates marker when contract changes', async () => {
      await signApp(baseContract, null);

      const [signature] = await signApp(updatedContract, baseMarker);

      expect(signature).toMatchObject({ status: 'updated', previous: baseMarker });
    });

    it('preserves existing invariants when re-signing with a new contract', async () => {
      // Sign re-anchors the marker hashes; it must not clobber the
      // applied-invariants set. `updateMarker` called without
      // `invariants` leaves the field untouched.
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: baseContract.storage.storageHash,
        profileHash: baseContract.profileHash,
        invariants: ['email-verified', 'phone-backfill'],
      });

      const [signature] = await signApp(updatedContract, baseMarker);
      expect(signature).toMatchObject({ status: 'updated' });

      const markerDoc = await db
        .collection<{ _id: string; invariants?: readonly string[] }>('_prisma_migrations')
        .findOne({ _id: 'app' });
      expect(markerDoc?.invariants).toEqual(['email-verified', 'phone-backfill']);
    });
  });
});
