/**
 * The advice to keep the documents of a collection whose model keeps its name, followed as printed when the plan creates the new collection only with its index (MongoDB).
 *
 * `Event` moves from `events` to `occasions` and has a unique index on `name`, so the plan has no `createCollection("occasions")`: `createIndex` creates it. The journey plans with `--delete Event`, edits `migration.ts` as the question says, runs node on it, and applies it with `db migrate`.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  followRenameCollectionAdvice,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  runPrintedSelfEmit,
} from '../utils/journey-test-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');
const DB_NAME = 'mongo_keep_indexed_documents';

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-keep-documents-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeProjectManifest(testDir);
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir };
}

async function emitFixture(ctx: JourneyContext, name: string, label: string): Promise<void> {
  copyFileSync(join(FIXTURES_DIR, name), join(ctx.testDir, 'contract.ts'));
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

describe('Journey (MongoDB): keeping the documents of a collection created only by its index', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let ctx: JourneyContext | undefined;

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
    if (ctx !== undefined) await rm(ctx.testDir, { recursive: true, force: true }).catch(() => {});
    await client?.close().catch(() => {});
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  it('renames the collection with its documents and index when migration.ts is edited as printed', async () => {
    const url = new URL(replSet.getUri());
    url.pathname = `/${DB_NAME}`;
    const project = setupProject(url.toString());
    ctx = project;
    await emitFixture(project, 'contract-with-indexed-events.ts', 'K.01');
    const initial = await runMigrationPlan(project, ['--name', 'initial']);
    expect(initial.exitCode, `K.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(project)).exitCode, 'K.03: migrate initial').toBe(0);
    const db = client.db(DB_NAME);
    await db.collection('events').insertMany([{ name: 'launch' }, { name: 'party' }]);
    const origin = latestMigrationDirName(project);

    await emitFixture(project, 'contract-indexed-events-remapped.ts', 'K.04');
    const asked = await runMigrationPlan(project, ['--from', origin, '--json']);
    expect(asked.exitCode, 'K.05: the drop of events needs a statement').toBe(2);
    const question = String(engineError(asked)?.why);
    expect(question, 'K.05: the question says where the rename goes').toContain(
      'make renameCollection("events", "occasions") the first operation, imported with the other operations, delete the drop of "events", and delete the create of "occasions" if there is one',
    );

    const remap = await runMigrationPlan(project, [
      '--name',
      'remap',
      '--from',
      origin,
      '--delete',
      'Event',
    ]);
    expect(remap.exitCode, `K.06: plan with --delete Event: ${remap.stderr}`).toBe(0);
    const remapDir = latestMigrationDirName(project);
    const migrationTs = join(project.testDir, 'migrations/app', remapDir, 'migration.ts');
    const planned = readFileSync(migrationTs, 'utf-8');
    expect(planned, 'K.07: occasions is created with its validator').toMatch(
      /createCollection\('occasions', \{\s*validator: \{/,
    );
    writeFileSync(migrationTs, followRenameCollectionAdvice(planned, 'events', 'occasions'));
    const emitted = runPrintedSelfEmit(question, dirname(migrationTs));
    expect(emitted.exitCode, `K.08: node on migration.ts, as printed: ${emitted.stderr}`).toBe(0);

    const applied = await runMigrate(project);
    expect(applied.exitCode, `K.09: db migrate: ${applied.stderr}`).toBe(0);
    const collections = (await db.listCollections().toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('_prisma'))
      .sort();
    const documents = await db
      .collection('occasions')
      .find({}, { projection: { _id: 0 } })
      .sort({ name: 1 })
      .toArray();
    const indexes = (await db.collection('occasions').indexes()).map(({ key, unique }) => ({
      key,
      unique: unique === true,
    }));
    expect({ collections, documents, indexes }, 'K.10: the documents and the index moved').toEqual({
      collections: ['occasions', 'users'],
      documents: [{ name: 'launch' }, { name: 'party' }],
      indexes: [
        { key: { _id: 1 }, unique: false },
        { key: { name: 1 }, unique: true },
      ],
    });
    const verify = await runDbVerify(project, ['--schema-only']);
    expect(verify.exitCode, `K.11: db verify --schema-only: ${verify.stderr}`).toBe(0);
    const further = await runMigrationPlan(project, ['--from', remapDir, '--json']);
    expect(further.exitCode, `K.12: a further plan: ${further.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(further).noOp, 'K.12: it is empty').toBe(true);
  });
});
