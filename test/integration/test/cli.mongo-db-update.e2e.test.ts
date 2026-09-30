import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';

function writeSchema(testDir: string, payloadType: string): void {
  writeFileSync(
    resolve(testDir, 'contract.prisma'),
    `// use prisma-8

model Event {
  id      ObjectId       @id @map("_id")
  payload ${payloadType}
  tags    ${payloadType}[]

  @@map("events")
}
`,
    'utf-8',
  );
}

describe('mongo db update command (e2e)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let mongoUri: string;
  const dbName = 'update_e2e_test';

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

    it('applies a Json to Bson field change without asking for confirmation', async () => {
      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma.config.psl.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeSchema(testSetup.testDir, 'Json');
      expect((await runOnEngine(testSetup, ['contract', 'emit'])).exitCode).toBe(0);
      expect((await runOnEngine(testSetup, ['db', 'init'])).exitCode).toBe(0);

      writeSchema(testSetup.testDir, 'Bson');
      expect((await runOnEngine(testSetup, ['contract', 'emit'])).exitCode).toBe(0);
      const run = await runOnEngine(testSetup, ['db', 'update', '--no-interactive']);

      expect(run.exitCode).toBe(0);
      const [collection] = await db
        .listCollections({ name: 'events' }, { nameOnly: false })
        .toArray();
      expect(collection?.options?.['validator']?.['$jsonSchema']?.['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        payload: {},
        tags: { bsonType: 'array', items: {} },
      });
    });
  });
});
