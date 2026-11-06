/**
 * A contract change that changes the storage hash but needs no database operation (MongoDB).
 *
 * `auth_users` is a collection the application does not manage (`controlPolicy: 'external'`): the planner plans nothing for it, but its indexes are part of the contract's storage. Adding an index the collection already has changes the storage hash and needs no operation.
 *
 * Journey N1 plans the change: `migration plan` writes a migration with no operations, names the collection that changed, and `migrate` moves the marker to the new hash. Journey N2 applies the same change with `db update`.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

interface NoOperationsPlan {
  readonly operations: readonly unknown[];
  readonly changedStorageEntities: readonly unknown[];
  readonly summary: string;
}

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-no-operations-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({ name: 'mongo-no-operations-journey', private: true, type: 'module' }),
    'utf-8',
  );
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir };
}

async function emitContract(ctx: JourneyContext, fixture: string, label: string): Promise<void> {
  copyFileSync(join(FIXTURES_DIR, fixture), join(ctx.testDir, 'contract.ts'));
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

async function seedAuthUsers(db: Db): Promise<void> {
  await db.createCollection('auth_users');
  await db.collection('auth_users').createIndex({ email: 1 }, { unique: true });
}

async function markerHash(db: Db): Promise<unknown> {
  const marker = await db
    .collection('_prisma_migrations')
    .findOne({ space: 'app', storageHash: { $exists: true } });
  return marker?.['storageHash'];
}

describe('Journeys (MongoDB): a plan with no operations', {
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

  it('N1: migration plan names the changed collection, and migrate moves the marker', async () => {
    const dbName = 'mongo_no_operations_plan';
    const db = client.db(dbName);
    await seedAuthUsers(db);
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emitContract(ctx, 'contract-external-auth-users.ts', 'N1.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `N1.02: plan initial: ${initial.stderr}`).toBe(0);
    const applyInitial = await runMigrate(ctx);
    expect(applyInitial.exitCode, `N1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    await emitContract(ctx, 'contract-external-auth-users-indexed.ts', 'N1.04');

    const plan = await runMigrationPlan(ctx, ['--from', origin, '--name', 'index', '--json']);
    expect(plan.exitCode, `N1.05: plan: ${plan.stderr}`).toBe(0);
    expect(parseJsonOutput<NoOperationsPlan>(plan), 'N1.05: no operations').toMatchObject({
      operations: [],
      changedStorageEntities: [
        expect.objectContaining({ entityKind: 'collection', entityName: 'auth_users' }),
      ],
      summary: expect.stringContaining('collection "'),
    });
    const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    expect(JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')), 'N1.05: ops.json').toEqual([]);

    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `N1.06: migrate: ${applied.stderr}`).toBe(0);
    expect(await markerHash(db), 'N1.06: the marker').toBe(readEmittedContractStorageHash(ctx));
    const verify = await runDbVerify(ctx);
    expect(verify.exitCode, `N1.07: db verify: ${verify.stderr}`).toBe(0);
  });

  it('N2: db update moves the marker to the new hash', async () => {
    const dbName = 'mongo_no_operations_update';
    const db = client.db(dbName);
    await seedAuthUsers(db);
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emitContract(ctx, 'contract-external-auth-users.ts', 'N2.01');
    const initial = await runDbUpdate(ctx);
    expect(initial.exitCode, `N2.02: db update initial: ${initial.stderr}`).toBe(0);
    await emitContract(ctx, 'contract-external-auth-users-indexed.ts', 'N2.03');

    const update = await runDbUpdate(ctx);
    expect(update.exitCode, `N2.04: db update: ${update.stderr}`).toBe(0);
    expect(await markerHash(db), 'N2.04: the marker').toBe(readEmittedContractStorageHash(ctx));
    const verify = await runDbVerify(ctx);
    expect(verify.exitCode, `N2.05: db verify: ${verify.stderr}`).toBe(0);
  });
});
