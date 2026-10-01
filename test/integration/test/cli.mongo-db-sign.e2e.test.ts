import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const SIGNED_STORAGE_HASH = `a1b2c3d${'0'.repeat(57)}`;
const UPDATED_STORAGE_HASH = `e5f6a7b${'1'.repeat(57)}`;

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
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
    storageHash: coreHash(SIGNED_STORAGE_HASH),
  },
  capabilities: {},
  extensions: {},
  profileHash: profileHash('mongo-sign-test'),
  meta: {},
};

function writeContractJson(testDir: string, contract: MongoContract): void {
  const outputDir = resolve(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'contract.json'), JSON.stringify(contract, null, 2), 'utf-8');
  writeFileSync(resolve(outputDir, 'contract.d.ts'), 'export type Contract = unknown;\n', 'utf-8');
}

function dbRefHash(testDir: string): string | undefined {
  const pointerPath = resolve(testDir, 'migrations', 'app', 'refs', 'db.json');
  if (!existsSync(pointerPath)) return undefined;
  return (JSON.parse(readFileSync(pointerPath, 'utf-8')) as { hash: string }).hash;
}

describe('mongo db sign command (e2e)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let mongoUri: string;
  const dbName = 'sign_e2e_test';

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

    it('creates marker when schema matches', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const run = await runOnEngine(testSetup, ['db', 'sign', '--json']);

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        summary: expect.stringContaining('marker created'),
        marker: { created: true, updated: false },
      });

      const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
      expect(marker).not.toBeNull();
      expect(marker!.storageHash).toBe(testContract.storage.storageHash);
      expect(dbRefHash(testSetup.testDir)).toBe(testContract.storage.storageHash);
    });

    it('re-sign is idempotent', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const firstSign = await runOnEngine(testSetup, ['db', 'sign', '--json']);
      expect(firstSign.exitCode).toBe(0);

      const secondSign = await runOnEngine(testSetup, ['db', 'sign', '--json']);

      expect(secondSign.exitCode).toBe(0);
      expect(secondSign.presented?.data).toMatchObject({
        ok: true,
        summary: expect.stringContaining('already signed'),
        marker: { created: false, updated: false },
      });
    });

    it('updates marker when contract changes', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const firstSign = await runOnEngine(testSetup, ['db', 'sign', '--json']);
      expect(firstSign.exitCode).toBe(0);

      const updatedContract: MongoContract = {
        ...testContract,
        storage: {
          ...testContract.storage,
          storageHash: coreHash(UPDATED_STORAGE_HASH),
        },
        profileHash: profileHash('mongo-sign-test-updated'),
      };
      writeContractJson(testSetup.testDir, updatedContract);

      const secondSign = await runOnEngine(testSetup, ['db', 'sign', '--json']);

      expect(secondSign.exitCode).toBe(0);
      expect(secondSign.presented?.data).toMatchObject({
        ok: true,
        summary: expect.stringContaining('marker updated'),
        marker: { created: false, updated: true },
      });

      const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
      expect(marker!.storageHash).toBe(updatedContract.storage.storageHash);
    });
  });
});
