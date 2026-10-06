import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import { MongoCollection, type MongoContract, MongoIndex } from '@internal/mongo-contract';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';

const controlAdapter = new MongoControlAdapterImpl();

const testContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: crossRef('User') },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          User: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              email: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
      },
    },
  },
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
    storageHash: coreHash('mongo-verify-test'),
  },
  capabilities: {},
  extensions: {},
  profileHash: profileHash('mongo-verify-test'),
  meta: {},
};

function writeContractJson(testDir: string, contract: MongoContract): void {
  const outputDir = resolve(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'contract.json'), JSON.stringify(contract, null, 2), 'utf-8');
}

describe('mongo db verify command (e2e)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let mongoUri: string;
  const dbName = 'verify_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger', dbName },
    });
    const baseUri = replSet.getUri();
    const url = new URL(baseUri);
    url.pathname = `/${dbName}`;
    mongoUri = url.toString();
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore cleanup errors
    }
  }, timeouts.spinUpMongoMemoryServer);

  withTempDir(({ createTempDir }) => {
    beforeEach(async () => {
      await db.dropDatabase();
    });

    it('reports error when marker is missing', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({ ok: false });
      expect(run.presented?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONTRACT.MARKER_MISSING' })]),
      );
    });

    it('verifies matching marker and schema', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: testContract.storage.storageHash,
        profileHash: testContract.profileHash!,
      });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        summary: expect.any(String),
      });
    });

    it('runs schema-only verification with matching schema', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'verify', '--schema-only', '--json']);

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        summary: expect.stringContaining('matches contract'),
        meta: { strict: false },
      });
    });

    it('fails schema-only verification when index is missing', async () => {
      await db.createCollection('users');

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'verify', '--schema-only', '--json']);

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({ ok: false });
    });

    it('runs marker-only verification with matching marker', async () => {
      await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
        storageHash: testContract.storage.storageHash,
        profileHash: testContract.profileHash!,
      });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'verify', '--marker-only', '--json']);

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        mode: 'marker-only',
      });
    });
  });
});
