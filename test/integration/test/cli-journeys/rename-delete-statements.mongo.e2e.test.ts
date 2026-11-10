/**
 * Journeys (MongoDB) for `--rename` and `--delete`, on PSL contracts with documents.
 *
 * R1 plans and migrates a model rename, a field rename with a unique index, a variant's field
 * rename and a field removal. R2 does the same through `db update`, then runs it again. R3 removes
 * a field through `db update` with no snapshot of the origin contract. R4 follows the question
 * about a field whose model the destination names differently. Every refusal is followed as
 * printed.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

const BEFORE = `// use prisma-8

model Profile {
  id       ObjectId @id @map("_id")
  name     String
  nickname String

  @@unique([name])
  @@map("profiles")
}

model Task {
  id    ObjectId @id @map("_id")
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  id    ObjectId @id @map("_id")
  score String

  @@base(Task, "bug")
}

model Feature {
  id    ObjectId @id @map("_id")
  score String

  @@base(Task, "feature")
}
`;

const AFTER = `// use prisma-8

model User {
  id       ObjectId @id @map("_id")
  fullName String

  @@unique([fullName])
  @@map("users")
}

model Task {
  id    ObjectId @id @map("_id")
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  id       ObjectId @id @map("_id")
  severity String

  @@base(Task, "bug")
}

model Feature {
  id    ObjectId @id @map("_id")
  score String

  @@base(Task, "feature")
}
`;

const RENAMES = [
  '--rename',
  'Profile:User',
  '--rename',
  'User.name:User.fullName',
  '--rename',
  'Bug.score:Bug.severity',
];

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-renames-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeProjectManifest(testDir);
  const configPath = writeMongoPslConfig(testDir, connectionString);
  return { testDir, configPath, outputDir };
}

async function useSchema(ctx: JourneyContext, schema: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), schema);
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

/** The flags a refusal's next actions print for `verb`, as they would be typed. */
function printedFlags(result: EngineCommandResult, verb: string): readonly string[] {
  const actions = JSON.stringify(engineError(result)?.nextActions ?? []);
  const pattern = new RegExp(`--${verb} (?:'([^']+)'|([^\\s"\\\\]+))`, 'g');
  return [...actions.matchAll(pattern)].flatMap((match) => [
    `--${verb}`,
    match[1] ?? match[2] ?? '',
  ]);
}

async function seed(db: Db): Promise<void> {
  await db.collection('profiles').insertMany([
    { name: 'Ada', nickname: 'a' },
    { name: 'Bo', nickname: 'b' },
  ]);
  await db.collection('tasks').insertMany([
    { title: 'crash', type: 'bug', score: 'high' },
    { title: 'dark mode', type: 'feature', score: 'p1' },
  ]);
}

async function documents(db: Db, collection: string) {
  return db
    .collection(collection)
    .find({}, { projection: { _id: 0 }, sort: { _id: 1 } })
    .toArray();
}

async function expectEndState(ctx: JourneyContext, db: Db, label: string): Promise<void> {
  const collections = (await db.listCollections().toArray())
    .map(({ name }) => name)
    .filter((name) => !name.startsWith('_prisma'))
    .sort();
  expect(
    {
      collections,
      users: await documents(db, 'users'),
      tasks: await documents(db, 'tasks'),
    },
    `${label}: documents under the new names`,
  ).toEqual({
    collections: ['tasks', 'users'],
    users: [{ fullName: 'Ada' }, { fullName: 'Bo' }],
    tasks: [
      { title: 'crash', type: 'bug', severity: 'high' },
      { title: 'dark mode', type: 'feature', score: 'p1' },
    ],
  });
  await expect(
    db.collection('users').updateOne({ fullName: 'Ada' }, { $set: { fullName: 'Ada L.' } }),
    `${label}: a user accepts an update`,
  ).resolves.toMatchObject({ modifiedCount: 1 });
  await expect(
    db.collection('tasks').updateOne({ type: 'bug' }, { $set: { severity: 'low' } }),
    `${label}: a bug accepts an update`,
  ).resolves.toMatchObject({ modifiedCount: 1 });
  await expect(
    db.collection('tasks').updateOne({ type: 'feature' }, { $set: { score: 'p2' } }),
    `${label}: a feature accepts an update`,
  ).resolves.toMatchObject({ modifiedCount: 1 });
  await expect(
    db.collection('users').insertOne({ fullName: 'Bo' }),
    `${label}: the unique index is on the new field`,
  ).rejects.toThrow(/duplicate key/);

  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
  expect(further.exitCode, `${label}: further plan: ${further.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations,
    `${label}: a further plan is empty`,
  ).toEqual([]);
}

describe('Journeys (MongoDB): --rename and --delete', {
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

  function project(dbName: string) {
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    return { ctx, db: client.db(dbName) };
  }

  it('R1: migration plan refuses until the printed --delete is given, then migrate renames and removes', async () => {
    const { ctx, db } = project('mongo_renames_plan');
    await useSchema(ctx, BEFORE, 'R1.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `R1.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'R1.03: migrate initial').toBe(0);
    await seed(db);
    const origin = latestMigrationDirName(ctx);
    await useSchema(ctx, AFTER, 'R1.04');

    const refused = await runMigrationPlan(ctx, ['--from', origin, ...RENAMES, '--json']);
    expect(refused.exitCode, 'R1.05: the removed field needs a statement').toBe(2);
    expect(engineError(refused)?.code, 'R1.05').toBe('CLI.CONSENT_REQUIRED');
    const printed = printedFlags(refused, 'delete');
    expect(printed, 'R1.05: the printed flag').toEqual(['--delete', 'User.nickname']);

    const plan = await runMigrationPlan(ctx, [
      '--name',
      'tidy',
      '--from',
      origin,
      ...RENAMES,
      ...printed,
      '--json',
    ]);
    expect(plan.exitCode, `R1.06: plan with the printed flag: ${plan.stderr}`).toBe(0);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `R1.07: migrate: ${applied.stderr}`).toBe(0);

    await expectEndState(ctx, db, 'R1.08');
  });

  it('R2: db update refuses until the printed --delete is given, then a second run fails on its first statement', async () => {
    const { ctx, db } = project('mongo_renames_update');
    await useSchema(ctx, BEFORE, 'R2.01');
    const create = await runDbUpdate(ctx, ['--no-interactive']);
    expect(create.exitCode, `R2.02: db update creates: ${create.stderr}`).toBe(0);
    await seed(db);
    await useSchema(ctx, AFTER, 'R2.03');

    const refused = await runDbUpdate(ctx, ['--no-interactive', ...RENAMES, '--json']);
    expect(refused.exitCode, 'R2.04: the removed field needs a statement').toBe(2);
    expect(engineError(refused)?.code, 'R2.04').toBe('CLI.CONSENT_REQUIRED');
    expect(await documents(db, 'profiles'), 'R2.04: nothing changed').toHaveLength(2);
    const printed = printedFlags(refused, 'delete');
    expect(printed, 'R2.04: the printed flag').toEqual(['--delete', 'User.nickname']);

    const updated = await runDbUpdate(ctx, ['--no-interactive', ...RENAMES, ...printed]);
    expect(updated.exitCode, `R2.05: db update with the printed flag: ${updated.stderr}`).toBe(0);

    await expectEndState(ctx, db, 'R2.06');

    const again = await runDbUpdate(ctx, ['--no-interactive', ...RENAMES, ...printed, '--json']);
    expect(again.exitCode, 'R2.07: the same statements again').not.toBe(0);
    expect(
      { code: engineError(again)?.code, summary: engineError(again)?.summary },
      'R2.07: it fails on the first statement',
    ).toMatchObject({
      code: 'MIGRATION.STATEMENT_UNRESOLVED',
      summary: expect.stringContaining('Profile:User'),
    });
  });

  it('R3: db update with no snapshot names a removed field by its collection, and --delete <collection>.<field> removes it', async () => {
    const { ctx, db } = project('mongo_renames_no_snapshot');
    await useSchema(ctx, BEFORE, 'R3.01');
    const create = await runDbUpdate(ctx, ['--no-interactive']);
    expect(create.exitCode, `R3.02: db update creates: ${create.stderr}`).toBe(0);
    await seed(db);
    rmSync(join(ctx.testDir, 'migrations'), { recursive: true, force: true });
    await useSchema(ctx, BEFORE.replace('  nickname String\n', ''), 'R3.03');

    const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(refused.exitCode, 'R3.04: the removed field needs a statement').toBe(2);
    const printed = printedFlags(refused, 'delete');
    expect(printed, 'R3.04: named by its collection').toEqual(['--delete', 'profiles.nickname']);
    expect(
      String(engineError(refused)?.why)
        .split('\n')
        .map((line) => line.slice(0, 3)),
      'R3.04: the question, then each way to keep the data on a line of its own',
    ).toEqual(['Rem', 'If ', '1. ', '2. ', '3. ']);

    const updated = await runDbUpdate(ctx, ['--no-interactive', ...printed]);
    expect(updated.exitCode, `R3.05: db update with the printed flag: ${updated.stderr}`).toBe(0);
    expect(await documents(db, 'profiles'), 'R3.05: the field is gone').toEqual([
      { name: 'Ada' },
      { name: 'Bo' },
    ]);
  });

  it('R4: a field whose model the destination names differently is renamed once the printed model rename is given', async () => {
    const { ctx, db } = project('mongo_renames_model_first');
    await useSchema(ctx, BEFORE, 'R4.01');
    const create = await runDbUpdate(ctx, ['--no-interactive']);
    expect(create.exitCode, `R4.02: db update creates: ${create.stderr}`).toBe(0);
    await seed(db);
    await useSchema(
      ctx,
      BEFORE.replace('model Profile {', 'model Person {').replace(
        '  nickname String',
        '  alias    String',
      ),
      'R4.03',
    );

    const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(refused.exitCode, 'R4.04: the removed field needs a statement').toBe(2);
    const question = JSON.stringify(engineError(refused));
    expect(question, 'R4.04: says to rename the model first').toContain(
      'also pass --rename Profile:<new model name>',
    );

    const modelFirst = await runDbUpdate(ctx, [
      '--no-interactive',
      '--rename',
      'Profile:Person',
      '--json',
    ]);
    expect(modelFirst.exitCode, 'R4.05: the field question now offers a rename').toBe(2);
    const renameForm = printedFlags(modelFirst, 'rename');
    expect(renameForm, 'R4.05: the printed rename form').toEqual([
      '--rename',
      'Person.nickname:Person.<new name>',
    ]);

    const renamed = await runDbUpdate(ctx, [
      '--no-interactive',
      '--rename',
      'Profile:Person',
      '--rename',
      'Person.nickname:Person.alias',
    ]);
    expect(renamed.exitCode, `R4.06: db update with both renames: ${renamed.stderr}`).toBe(0);
    expect(await documents(db, 'profiles'), 'R4.06: the values are kept').toEqual([
      { name: 'Ada', alias: 'a' },
      { name: 'Bo', alias: 'b' },
    ]);
  });
});
