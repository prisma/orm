import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from './cli-test-helpers';
import {
  type EngineCommandResult,
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
} from './journey-test-helpers';
import { writeMongoPslConfig } from './journey-workspace-helpers';
import { withoutEngineLine } from './stored-name-journeys';

/** A MongoDB project of a journey: its context, its database, and the last migration it planned. */
export interface MongoJourney {
  readonly ctx: JourneyContext;
  readonly db: Db;
  origin: string | undefined;
}

/** Starts a replica set for the file and gives each journey a project and a database of its own. */
export function useMongoJourneys(prefix: string): (dbName: string) => MongoJourney {
  let replSet: MongoMemoryReplSet | undefined;
  let client: MongoClient | undefined;
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
    for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => {});
    created.clear();
  });

  afterAll(async () => {
    await client?.close().catch(() => {});
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  return (dbName) => {
    if (replSet === undefined || client === undefined) throw new Error('MongoDB is not started');
    const url = new URL(replSet.getUri());
    url.pathname = `/${dbName}`;
    const testDir = join(
      fixtureAppDir,
      `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const outputDir = join(testDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(join(testDir, 'migrations'), { recursive: true });
    writeProjectManifest(testDir);
    const configPath = writeMongoPslConfig(testDir, url.toString());
    created.add(testDir);
    return { ctx: { testDir, configPath, outputDir }, db: client.db(dbName), origin: undefined };
  };
}

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

/** Uses the TypeScript contract fixture `name` in place of a PSL contract, and emits it. */
export async function useFixture(journey: MongoJourney, name: string, label: string) {
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => readFileSync(journey.ctx.configPath, 'utf-8').match(/mongodb:\/\/[^'"`]+/)?.[0] ?? '',
  );
  writeFileSync(journey.ctx.configPath, config);
  copyFileSync(join(FIXTURES_DIR, name), join(journey.ctx.testDir, 'contract.ts'));
  const emitted = await runContractEmit(journey.ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
}

/** Writes `contract.prisma` and emits it. */
export async function useSchema(journey: MongoJourney, schema: string, label: string) {
  writeFileSync(join(journey.ctx.testDir, 'contract.prisma'), schema);
  const emitted = await runContractEmit(journey.ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

/** The labels of the operations a `migration plan --json` or `db update --json` reports. */
export function operationLabels(result: EngineCommandResult): readonly string[] {
  const output = parseJsonOutput<{
    readonly operations?: readonly { readonly label: string }[];
    readonly plan?: { readonly operations: readonly { readonly label: string }[] };
  }>(result);
  return (output.operations ?? output.plan?.operations ?? []).map(({ label }) => label);
}

/** Plans the change with `migration plan` from the last migration, applies it with `db migrate`, and returns the labels of its operations. */
export async function planAndMigrate(
  journey: MongoJourney,
  args: readonly string[],
  label: string,
): Promise<readonly string[]> {
  const planned = await runMigrationPlan(journey.ctx, [
    '--name',
    label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
    ...args,
    '--json',
  ]);
  expect(planned.exitCode, `${label}: migration plan: ${planned.stderr}`).toBe(0);
  const applied = await runMigrate(journey.ctx);
  expect(applied.exitCode, `${label}: db migrate: ${applied.stderr}`).toBe(0);
  journey.origin = latestMigrationDirName(journey.ctx);
  return operationLabels(planned);
}

/** The `migration.ts` of the last migration planned. */
export function latestMigrationTs(journey: MongoJourney): string {
  return readFileSync(
    join(
      journey.ctx.testDir,
      'migrations/app',
      latestMigrationDirName(journey.ctx),
      'migration.ts',
    ),
    'utf-8',
  );
}

/** Applies the change with `db update` and returns the labels of its operations. */
export async function update(
  journey: MongoJourney,
  args: readonly string[],
  label: string,
): Promise<readonly string[]> {
  const updated = await runDbUpdate(journey.ctx, ['--no-interactive', ...args, '--json']);
  expect(updated.exitCode, `${label}: db update: ${updated.stderr}`).toBe(0);
  return operationLabels(updated);
}

export type Command = 'migration plan' | 'db update';

/** Runs the change with `command`, expects it refused, and returns the error, without the line the CLI engine writes for a consent error. */
export async function refused(
  journey: MongoJourney,
  command: Command,
  args: readonly string[],
  label: string,
): Promise<Omit<Diagnostic, 'summary'> & { readonly summary?: string }> {
  const result =
    command === 'db update'
      ? await runDbUpdate(journey.ctx, ['--no-interactive', ...args, '--json'])
      : await runMigrationPlan(journey.ctx, [
          ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
          ...args,
          '--json',
        ]);
  expect(result.exitCode, `${label}: ${command} is refused`).not.toBe(0);
  const error = engineError(result);
  if (error === undefined) throw new Error(`${label}: no error: ${result.stderr}`);
  return withoutEngineLine(error);
}

/** Applies the change with `command`, returning the labels of its operations. */
export function apply(
  journey: MongoJourney,
  command: Command,
  args: readonly string[],
  label: string,
): Promise<readonly string[]> {
  return command === 'db update'
    ? update(journey, args, label)
    : planAndMigrate(journey, args, label);
}

/** Starts the journey at `schema`, with the collections created by the same command. */
export async function begin(
  journey: MongoJourney,
  command: Command,
  schema: string,
  label: string,
): Promise<void> {
  await useSchema(journey, schema, `${label} schema`);
  await apply(journey, command, [], `${label} start`);
}

export async function documents(db: Db, collection: string) {
  return db
    .collection(collection)
    .find({}, { projection: { _id: 0 }, sort: { _id: 1 } })
    .toArray();
}

export async function collections(db: Db): Promise<readonly string[]> {
  return (await db.listCollections().toArray())
    .map(({ name }) => name)
    .filter((name) => !name.startsWith('_prisma'))
    .sort();
}

/** `db update` finds nothing left to plan against the database. */
export async function expectSettled(journey: MongoJourney, label: string): Promise<void> {
  const further = await runDbUpdate(journey.ctx, ['--dry-run', '--no-interactive', '--json']);
  expect(further.exitCode, `${label}: further plan: ${further.stderr}`).toBe(0);
  expect(operationLabels(further), `${label}: nothing left to plan`).toEqual([]);
}
