/**
 * Field changes on a MongoDB contract written in TypeScript, planned and applied as on PSL.
 *
 * The contract gives each collection a validator, so field names are in the storage hash and a field rename or removal changes it. Journey T1 renames `Event.name` with `migration plan --rename` and applies it with `db migrate`. Journey T2 removes the field: `migration plan` asks for the removal, then plans it with the printed `--delete`, and `db migrate` applies it.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-ts-field-changes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'mongo-ts-field-changes-journey',
      private: true,
      type: 'module',
      dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
    }),
    'utf-8',
  );
  copyFileSync(join(FIXTURES_DIR, 'contract-with-events.ts'), join(testDir, 'contract.ts'));
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir };
}

async function useFixture(ctx: JourneyContext, name: string, label: string): Promise<void> {
  copyFileSync(join(FIXTURES_DIR, name), join(ctx.testDir, 'contract.ts'));
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

describe('Journeys (MongoDB): field changes on a TypeScript contract', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const created = new Set<string>();

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

  afterEach(async () => {
    for (const dir of created) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    created.clear();
  });

  afterAll(async () => {
    await client?.close().catch(() => {});
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  async function migratedProject(dbName: string, label: string) {
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await useFixture(ctx, 'contract-with-events.ts', `${label}.01`);
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.03: migrate initial`).toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    return { ctx, origin: latestMigrationDirName(ctx) };
  }

  async function events(dbName: string) {
    return client
      .db(dbName)
      .collection('events')
      .find({}, { projection: { _id: 0 } })
      .toArray();
  }

  it('T1: migration plan renames a field, and db migrate applies it', async () => {
    const dbName = 'mongo_ts_field_rename';
    const { ctx, origin } = await migratedProject(dbName, 'T1');
    await useFixture(ctx, 'contract-events-name-renamed.ts', 'T1.04');

    const plan = await runMigrationPlan(ctx, [
      '--name',
      'rename',
      '--from',
      origin,
      '--rename',
      'Event.name:Event.title',
      '--json',
    ]);
    expect(plan.exitCode, `T1.05: plan: ${plan.stderr}`).toBe(0);
    expect(getMigrationDirs(ctx), 'T1.05: the migration is written').toHaveLength(2);

    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `T1.06: db migrate: ${applied.stderr}`).toBe(0);
    expect(await events(dbName), 'T1.06: the value is under the new name').toEqual([
      { title: 'launch' },
    ]);
  });

  it('T2: migration plan asks for a field removal, plans it with the printed --delete, and db migrate applies it', async () => {
    const dbName = 'mongo_ts_field_remove';
    const { ctx, origin } = await migratedProject(dbName, 'T2');
    await useFixture(ctx, 'contract-events-name-removed.ts', 'T2.04');

    const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(asked.exitCode, 'T2.05: the removal needs a statement').toBe(2);
    expect(engineError(asked)?.code, 'T2.05').toBe('CLI.CONSENT_REQUIRED');

    const plan = await runMigrationPlan(ctx, [
      '--name',
      'remove',
      '--from',
      origin,
      '--delete',
      'Event.name',
      '--json',
    ]);
    expect(plan.exitCode, `T2.06: plan: ${plan.stderr}`).toBe(0);

    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `T2.07: db migrate: ${applied.stderr}`).toBe(0);
    expect(await events(dbName), 'T2.07: the field is gone').toEqual([{}]);
  });
});
