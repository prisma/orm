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
  engineError,
  type JourneyContext,
  runContractEmit,
  runDbInit,
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

function setupPslProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-init-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'mongo-init-journey',
      private: true,
      type: 'module',
      dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
    }),
    'utf-8',
  );
  writeFileSync(
    join(testDir, 'contract.prisma'),
    '// use prisma-8\n\nmodel Event {\n  id   ObjectId @id @map("_id")\n  name String\n\n  @@map("events")\n}\n',
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    [
      "import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';",
      "import { definePrismaConfig } from '@prisma/cli-engine';",
      '',
      'export default definePrismaConfig({',
      '  orm: ormConfig({',
      "    contract: './contract.prisma',",
      "    output: 'output',",
      `    db: { connection: ${JSON.stringify(connectionString)} },`,
      '  }),',
      '});',
      '',
    ].join('\n'),
  );
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

  it('points db init at db update when a collection with data needs a validator', async () => {
    const dbName = 'mongo_init_journey';
    const connectionString = withDatabase(replSet.getUri(), dbName);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    const ctx = setupPslProject(connectionString);
    created.add(ctx.testDir);

    const emit = await runContractEmit(ctx);
    expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);
    const init = await runDbInit(ctx, ['--no-interactive', '--json']);

    expect(init.exitCode).toBe(2);
    expect(engineError(init)).toMatchObject({
      code: 'MIGRATION.PLANNING_FAILED',
      nextActions: [
        expect.objectContaining({ kind: 'run-command', command: 'prisma-test db update' }),
      ],
    });

    const update = await runDbUpdate(ctx, [
      '--no-interactive',
      '--confirm',
      consentTokenFor(connectionString),
    ]);
    expect(update.exitCode, stripAnsi(update.stderr)).toBe(0);
    const [collection] = await client.db(dbName).listCollections({ name: 'events' }).toArray();
    expect(collection).toMatchObject({
      options: { validator: { $jsonSchema: expect.any(Object) } },
    });
  });
});
