/**
 * `--convert` and `--backfill` write a data transform to fill in (MongoDB).
 *
 * Journey D1 changes `User.age` from `String` to `Int` and plans it with `--convert User.age`: `migration.ts` has the data transform with its check and filter written and its update as a placeholder. The journey fills the update, runs the file, and applies it; the validator change's document check then passes. Journey D2 adds a required `User.plan` and plans it with `--backfill User.plan` the same way. Journey D3 gives both statements to `db update`, which refuses them, since only a migration file can hold the code to fill in.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function usersPsl(fields: string): string {
  return `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String
${fields}

  @@map("users")
}
`;
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-scaffolds-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeProjectManifest(testDir);
  const configPath = writeMongoPslConfig(testDir, connectionString);
  return { testDir, configPath, outputDir };
}

async function emitFields(ctx: JourneyContext, fields: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), usersPsl(fields), 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

describe('Journeys (MongoDB): --convert and --backfill write a data transform to fill in', {
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

  async function initialize(ctx: JourneyContext, fields: string): Promise<string> {
    await emitFields(ctx, fields, 'initial');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'migrate initial').toBe(0);
    return latestMigrationDirName(ctx);
  }

  async function planFillAndApply(
    ctx: JourneyContext,
    origin: string,
    statement: readonly string[],
    slot: string,
    update: string,
  ): Promise<string> {
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'scaffold',
      '--from',
      origin,
      ...statement,
      '--json',
    ]);
    expect(planned.exitCode, `plan with ${statement.join(' ')}: ${planned.stderr}`).toBe(0);
    expect(
      parseJsonOutput<{ pendingPlaceholders: boolean; operations: { label: string }[] }>(planned),
      'the plan lists the data transform and reports the placeholder to fill in',
    ).toMatchObject({
      pendingPlaceholders: true,
      operations: expect.arrayContaining([
        {
          id: `data_transform.${slot.replace(':update', '')}`,
          label: `Data transform: ${slot.replace(':update', '')}`,
          operationClass: 'data',
        },
      ]),
    });
    const migrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const migrationTsPath = join(migrationDir, 'migration.ts');
    const scaffold = readFileSync(migrationTsPath, 'utf-8');
    const slotCall = new RegExp(`placeholder\\(['"]${slot.replace('.', '\\.')}['"]\\)`);
    expect(scaffold, 'migration.ts has the slot to fill').toMatch(slotCall);
    writeFileSync(migrationTsPath, scaffold.replace(slotCall, update));

    const emitted = await selfEmitMigration(ctx, [
      '--dir',
      migrationDir,
      '--config',
      ctx.configPath,
    ]);
    expect(emitted.exitCode, `node migration.ts: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
    return scaffold;
  }

  it('D1: --convert writes a data transform whose update the user fills', async () => {
    const dbName = 'mongo_scaffold_convert';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    const origin = await initialize(ctx, '  age   String');
    await client
      .db(dbName)
      .collection('users')
      .insertMany([
        { email: 'ada@example.com', age: '42' },
        { email: 'bo@example.com', age: 'forty' },
      ]);

    await emitFields(ctx, '  age   Int', 'D1.01');
    const scaffold = await planFillAndApply(
      ctx,
      origin,
      ['--convert', 'User.age'],
      'User.age:update',
      "[{ $set: { age: { $convert: { input: '$age', to: 'int', onError: 0 } } } }]",
    );
    expect(scaffold, 'D1.02: the run skips document validation').toContain(
      'bypassDocumentValidation: true',
    );

    const ages = await client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0, email: 1, age: 1 } })
      .sort({ email: 1 })
      .toArray();
    expect(ages, 'D1.03: every age is an int').toEqual([
      { email: 'ada@example.com', age: 42 },
      { email: 'bo@example.com', age: 0 },
    ]);
  });

  it('D2: --backfill writes a data transform that fills a new required field', async () => {
    const dbName = 'mongo_scaffold_backfill';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    const origin = await initialize(ctx, '');
    await client
      .db(dbName)
      .collection('users')
      .insertMany([{ email: 'ada@example.com' }, { email: 'bo@example.com' }]);

    await emitFields(ctx, '  plan  String', 'D2.01');
    await planFillAndApply(
      ctx,
      origin,
      ['--backfill', 'User.plan'],
      'User.plan:update',
      "{ $set: { plan: 'free' } }",
    );

    const plans = await client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0, plan: 1 } })
      .toArray();
    expect(plans, 'D2.02: every document has a plan').toEqual([{ plan: 'free' }, { plan: 'free' }]);
  });

  it('D3: db update refuses --convert and --backfill, which need a migration file', async () => {
    const dbName = 'mongo_scaffold_db_update';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emitFields(ctx, '  age   String', 'D3.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'D3.02: db update').toBe(0);

    await emitFields(ctx, '  age   Int\n  plan  String', 'D3.03');
    const codes = await Promise.all(
      [
        ['--convert', 'User.age'],
        ['--backfill', 'User.plan'],
      ].map(
        async (statement) =>
          engineError(await runDbUpdate(ctx, ['--no-interactive', '--json', ...statement]))?.code,
      ),
    );
    expect(codes, 'D3.04: both are refused').toEqual([
      'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
      'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
    ]);
  });
});
