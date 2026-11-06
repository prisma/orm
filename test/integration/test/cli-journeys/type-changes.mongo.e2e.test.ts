/**
 * A field whose type changes (MongoDB).
 *
 * Journey T1 changes `User.age` from `String` to `Int` on documents: `migration plan` asks, offering `--convert User.age` and `--delete User.age`; `--delete` plans a `castField`, and `db migrate` casts `"42"` to `42`. Journey T2 changes it from `DateTime` to `Int`, which `$convert` has no cast for: the plan is refused, pointing to `--convert` only. Journey T3 changes `Int` to `Int64` through `db update`, which casts every value with nothing asked.
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
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function usersPsl(ageType: string): string {
  return `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String
  age   ${ageType}

  @@map("users")
}
`;
}

function setupProject(connectionString: string, ageType: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-type-changes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeProjectManifest(testDir);
  writeFileSync(join(testDir, 'contract.prisma'), usersPsl(ageType), 'utf-8');
  const configPath = writeMongoPslConfig(testDir, connectionString);
  return { testDir, configPath, outputDir };
}

async function emitAge(ctx: JourneyContext, ageType: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), usersPsl(ageType), 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

describe('Journeys (MongoDB): a field whose type changes', {
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

  async function initialize(ctx: JourneyContext, ageType: string): Promise<string> {
    await emitAge(ctx, ageType, 'initial');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'migrate initial').toBe(0);
    return latestMigrationDirName(ctx);
  }

  async function ageTypes(dbName: string): Promise<unknown[]> {
    const documents = await client
      .db(dbName)
      .collection('users')
      .aggregate([{ $sort: { email: 1 } }, { $project: { _id: 0, type: { $type: '$age' } } }])
      .toArray();
    return documents.map((document) => document['type']);
  }

  it('T1: asks about String to Int, and --delete casts the values', async () => {
    const dbName = 'mongo_type_change_lossy';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName), 'String');
    created.add(ctx.testDir);
    const origin = await initialize(ctx, 'String');
    await client
      .db(dbName)
      .collection('users')
      .insertMany([
        { email: 'ada@example.com', age: '42' },
        { email: 'bo@example.com', age: '7' },
      ]);

    await emitAge(ctx, 'Int', 'T1.01');
    const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(asked.exitCode, 'T1.02: the type change needs a statement').toBe(2);
    const actions = JSON.stringify(engineError(asked)?.nextActions ?? []);
    expect(
      {
        convert: actions.includes('--convert User.age'),
        delete: actions.includes('--delete User.age'),
      },
      `T1.02: the question offers both answers: ${actions}`,
    ).toEqual({ convert: true, delete: true });

    const planned = await runMigrationPlan(ctx, [
      '--name',
      'age-int',
      '--from',
      origin,
      '--delete',
      'User.age',
    ]);
    expect(planned.exitCode, `T1.03: plan with --delete User.age: ${planned.stderr}`).toBe(0);
    const migrationTs = readFileSync(
      join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx), 'migration.ts'),
      'utf-8',
    );
    expect(migrationTs, 'T1.04: migration.ts casts the field').toMatch(
      /castField\(\s*['"]users['"],\s*['"]age['"],\s*\{\s*from: \[['"]string['"]\],\s*to: ['"]int['"]\s*\}\s*\)/,
    );

    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `T1.05: db migrate: ${applied.stderr}`).toBe(0);
    expect(await ageTypes(dbName), 'T1.06: every age is an int').toEqual(['int', 'int']);
  });

  it('T2: refuses DateTime to Int, which MongoDB has no cast for, pointing to --convert only', async () => {
    const dbName = 'mongo_type_change_no_cast';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName), 'DateTime');
    created.add(ctx.testDir);
    const origin = await initialize(ctx, 'DateTime');

    await emitAge(ctx, 'Int', 'T2.01');
    const refused = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    const error = engineError(refused);
    const text = JSON.stringify(error ?? {});
    expect(refused.exitCode, 'T2.02: the plan is refused').not.toBe(0);
    expect(
      {
        noCast: text.includes('MongoDB has no cast from date to int'),
        convert: text.includes('--convert User.age'),
        delete: text.includes('--delete User.age'),
      },
      `T2.02: only --convert is offered: ${text}`,
    ).toEqual({ noCast: true, convert: true, delete: false });
  });

  it('T3: db update casts Int to Int64 with nothing asked', async () => {
    const dbName = 'mongo_type_change_widening';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName), 'Int');
    created.add(ctx.testDir);
    await initialize(ctx, 'Int');
    await client
      .db(dbName)
      .collection('users')
      .insertMany([
        { email: 'ada@example.com', age: 36 },
        { email: 'bo@example.com', age: 41 },
      ]);

    await emitAge(ctx, 'Int64', 'T3.01');
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(updated.exitCode, `T3.02: db update: ${updated.stderr}`).toBe(0);
    expect(await ageTypes(dbName), 'T3.03: every age is a long').toEqual(['long', 'long']);
  });
});
