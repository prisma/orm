import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import stripAnsi from 'strip-ansi';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  consentTokenFor,
  type JourneyContext,
  runContractEmit,
  runDbUpdate,
} from '../utils/journey-test-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');
const DB_NAME = 'mongo_consent_journey';

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-consent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'mongo-consent-journey',
      private: true,
      type: 'module',
      dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
    }),
    'utf-8',
  );
  copyFileSync(join(FIXTURES_DIR, 'contract-additive.ts'), join(testDir, 'contract.ts'));
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir };
}

describe('Journey: Mongo db update confirms destructive changes', {
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

  it('drops an index once the database name is passed with --confirm', async () => {
    const connectionString = withDatabase(replSet.getUri(), DB_NAME);
    const ctx = setupProject(connectionString);
    created.add(ctx.testDir);

    expect((await runContractEmit(ctx)).exitCode).toBe(0);
    const additive = await runDbUpdate(ctx, ['--no-interactive']);
    expect(additive.exitCode, stripAnsi(additive.stderr)).toBe(0);

    copyFileSync(join(FIXTURES_DIR, 'contract-base.ts'), join(ctx.testDir, 'contract.ts'));
    expect((await runContractEmit(ctx)).exitCode).toBe(0);

    const destructive = await runDbUpdate(ctx, [
      '--no-interactive',
      '--confirm',
      consentTokenFor(connectionString),
    ]);

    expect(destructive.exitCode, stripAnsi(destructive.stderr)).toBe(0);
    const indexKeys = (await client.db(DB_NAME).collection('users').indexes()).map(
      (index) => index.key,
    );
    expect(indexKeys).toEqual([{ _id: 1 }, { email: 1 }]);
  });
});
