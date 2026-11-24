/**
 * Each saved MongoDB sample set, run by this release against an in-process replica set: the saved migrations apply to an empty database, and a database whose `_prisma_migrations` collection holds the documents the saved release wrote is read as up to date and can be queried.
 */

import { readFileSync } from 'node:fs';
import mongo from '@internal/mongo/runtime';
import { contractFromJson } from '@internal/mongo/static';
import { timeouts } from '@repo/test-utils';
import { BSON, type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  migrationStatusAppSpace,
  parseMigrationStatusJson,
  runDbVerify,
  runMigrate,
  runMigrationStatus,
} from '../utils/journey-test-helpers';
import {
  copySampleProject,
  emittedContractPath,
  loadMongoRecords,
  mongoRecordCollection,
  sampleDatabaseDir,
  sampleSetExists,
  savedReleases,
} from './sample-projects';

const releases = savedReleases().filter((release) => sampleSetExists(release, 'mongo'));

async function expectMigrated(ctx: JourneyContext): Promise<void> {
  const migrated = await runMigrate(ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
}

async function expectVerified(ctx: JourneyContext): Promise<void> {
  const verified = await runDbVerify(ctx);
  expect(verified.exitCode, `db verify: ${verified.stdout}\n${verified.stderr}`).toBe(0);
}

async function ledgerNames(db: Db): Promise<string[]> {
  const entries = await db
    .collection(mongoRecordCollection)
    .find({ type: 'ledger' }, { sort: { _id: 1 } })
    .toArray();
  return entries.map((entry) => `${entry['space']}/${entry['migrationName']}`);
}

function savedLedgerNames(release: string): string[] {
  const documents = BSON.EJSON.parse(
    readFileSync(
      join(sampleDatabaseDir(release, 'mongo'), `${mongoRecordCollection}.json`),
      'utf8',
    ),
  ) as readonly Record<string, unknown>[];
  return documents
    .filter((document) => document['type'] === 'ledger')
    .map((document) => `${document['space']}/${document['migrationName']}`);
}

describe.each(releases)(
  'the MongoDB sample set %s',
  { timeout: timeouts.spinUpMongoMemoryServer },
  (release) => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let databases = 0;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      await client?.close();
      await replSet?.stop();
    }, timeouts.spinUpMongoMemoryServer);

    function newDatabase(): { readonly dbName: string; readonly connectionString: string } {
      databases += 1;
      const dbName = `saved_samples_${databases}`;
      return { dbName, connectionString: replSet.getUri(dbName) };
    }

    withTempDir(({ createTempDir }) => {
      it('applies to an empty database, which then verifies', async () => {
        const { dbName, connectionString } = newDatabase();
        const ctx = copySampleProject(release, 'mongo', createTempDir(), connectionString);

        await expectMigrated(ctx);
        expect(await ledgerNames(client.db(dbName))).toEqual(savedLedgerNames(release));
        await expectVerified(ctx);
      });

      it('is up to date on a database holding the records it saved, and the database can be queried', async () => {
        const { dbName, connectionString } = newDatabase();
        const ctx = copySampleProject(release, 'mongo', createTempDir(), connectionString);
        await expectMigrated(ctx);
        await loadMongoRecords(client.db(dbName), sampleDatabaseDir(release, 'mongo'));

        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, `migration status: ${status.stdout}\n${status.stderr}`).toBe(0);
        const { currentContract, targetContract, migrations } = migrationStatusAppSpace(
          parseMigrationStatusJson(status),
        );
        const named = (status: string) =>
          migrations.filter((m) => m.status === status).map((m) => `app/${m.name}`);
        expect({
          currentContract,
          applied: named('applied').sort(),
          pending: named('pending'),
        }).toEqual({
          currentContract: targetContract,
          applied: savedLedgerNames(release).sort(),
          pending: [],
        });

        const migrated = await runMigrate(ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        expect(migrated.stderr).toContain('Already up to date');
        expect(await ledgerNames(client.db(dbName))).toEqual(savedLedgerNames(release));

        await expectVerified(ctx);

        const db = mongo({
          contract: contractFromJson(
            JSON.parse(readFileSync(join(ctx.testDir, emittedContractPath.mongo), 'utf8')),
          ),
          mongoClient: client,
          dbName,
        });
        const users = (
          db.orm as unknown as Record<
            string,
            {
              create(row: Record<string, unknown>): Promise<unknown>;
              select(...fields: string[]): { all(): AsyncIterable<unknown> };
            }
          >
        )['users'];
        if (users === undefined)
          throw new Error(`the ORM exposes no users; it has ${Object.keys(db.orm)}`);
        await users.create({ email: 'ada@example.com', role: 'ADMIN', name: 'Ada' });
        const rows: unknown[] = [];
        for await (const row of users.select('email', 'role', 'name').all()) rows.push(row);
        expect(rows).toEqual([{ email: 'ada@example.com', role: 'ADMIN', name: 'Ada' }]);
      });
    });
  },
);
