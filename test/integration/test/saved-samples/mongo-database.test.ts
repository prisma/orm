/**
 * Each saved MongoDB sample set, run by this release against an in-process replica set: the saved migrations apply to an empty database, and a database whose `_prisma_migrations` collection holds the documents the saved release wrote is read as up to date, keeps every saved document, and can be queried.
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
  readMongoRecords,
  readSampleJson,
  sampleDatabaseDir,
  sampleQueryPath,
  sampleSetExists,
  sampleSpaces,
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
  return readMongoRecords(sampleDatabaseDir(release, 'mongo'))
    .filter((document) => document['type'] === 'ledger')
    .map((document) => `${document['space']}/${document['migrationName']}`);
}

interface SavedQuery {
  readonly root: string;
  readonly row: Record<string, unknown>;
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
        const statusJson = parseMigrationStatusJson(status);
        for (const space of sampleSpaces(release, 'mongo')) {
          const { currentContract, targetContract, migrations } = migrationStatusAppSpace(
            statusJson,
            space,
          );
          const named = (status: string) =>
            migrations.filter((m) => m.status === status).map((m) => `${space}/${m.name}`);
          expect({
            currentContract,
            applied: named('applied').sort(),
            pending: named('pending'),
          }).toEqual({
            currentContract: targetContract,
            applied: savedLedgerNames(release)
              .filter((name) => name.startsWith(`${space}/`))
              .sort(),
            pending: [],
          });
        }

        const migrated = await runMigrate(ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        expect(migrated.stderr).toContain('Already up to date');
        expect(await ledgerNames(client.db(dbName))).toEqual(savedLedgerNames(release));

        await expectVerified(ctx);

        const canonical = (document: unknown) => BSON.EJSON.serialize(document, { relaxed: false });
        expect(
          (await client.db(dbName).collection(mongoRecordCollection).find({}).toArray()).map(
            canonical,
          ),
        ).toEqual(
          expect.arrayContaining(
            readMongoRecords(sampleDatabaseDir(release, 'mongo')).map((document) =>
              expect.objectContaining(canonical(document)),
            ),
          ),
        );

        const db = mongo({
          contract: contractFromJson(
            JSON.parse(readFileSync(join(ctx.testDir, emittedContractPath.mongo), 'utf8')),
          ),
          mongoClient: client,
          dbName,
        });
        const query = readSampleJson(sampleQueryPath(release, 'mongo')) as SavedQuery;
        const root = (
          db.orm as unknown as Record<
            string,
            {
              create(row: Record<string, unknown>): Promise<unknown>;
              select(...fields: string[]): { all(): AsyncIterable<unknown> };
            }
          >
        )[query.root];
        if (root === undefined)
          throw new Error(`the ORM exposes no ${query.root}; it has ${Object.keys(db.orm)}`);
        await root.create(query.row);
        const rows: unknown[] = [];
        for await (const row of root.select(...Object.keys(query.row)).all()) rows.push(row);
        expect(rows).toEqual([query.row]);
      });
    });
  },
);
