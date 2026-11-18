/**
 * Steps shared by the journeys of a model, field or enum member that keeps its name while its stored name or stored value changes, on PostgreSQL and SQLite.
 *
 * A journey starts at a contract through `migration plan` and `db migrate`, or through `db update`, and then plans the change with the same command. The database is reached the same way on both targets, so the journeys compare rows with the same queries.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { expect } from 'vitest';
import { writeProjectManifest } from './cli-test-helpers';
import {
  type EngineCommandResult,
  engineError,
  expectMigrationTsReproducesOps,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  sql,
  sqlitePslConfigFixture,
} from './journey-test-helpers';

export type Command = 'migration plan' | 'db update';

export const COMMANDS: readonly Command[] = ['migration plan', 'db update'];

export type JourneyDatabase =
  | { readonly kind: 'postgres'; readonly connectionString: string }
  | { readonly kind: 'sqlite'; readonly path: string };

export interface StoredNameJourney extends JourneyContext {
  readonly database: JourneyDatabase;
  readonly command: Command;
}

export interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

export function postgresJourney(
  connectionString: string,
  createTempDir: () => string,
  command: Command,
): StoredNameJourney {
  const ctx = setupJourney({ connectionString, createTempDir, contractMode: 'psl' });
  return { ...ctx, database: { kind: 'postgres', connectionString }, command };
}

export function sqliteJourney(createTempDir: () => string, command: Command): StoredNameJourney {
  const testDir = createTempDir();
  const path = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => path);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, database: { kind: 'sqlite', path }, command };
}

function withSqlite<T>(path: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

export async function rows(
  journey: StoredNameJourney,
  query: string,
): Promise<readonly Record<string, unknown>[]> {
  const database = journey.database;
  if (database.kind === 'postgres') return (await sql(database.connectionString, query)).rows;
  return withSqlite(database.path, (db) =>
    db
      .prepare(query)
      .all()
      .map((row) => ({ ...row })),
  );
}

export async function execute(journey: StoredNameJourney, statements: string): Promise<void> {
  const database = journey.database;
  if (database.kind === 'postgres') {
    await sql(database.connectionString, statements);
    return;
  }
  withSqlite(database.path, (db) => db.exec(statements));
}

/** The tables of the application, without the tables Prisma keeps its records in. */
export async function tableNames(journey: StoredNameJourney): Promise<readonly string[]> {
  const query =
    journey.database.kind === 'postgres'
      ? "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%' ORDER BY tablename"
      : "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_prisma%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name";
  return (await rows(journey, query)).map((row) => String(row['name']));
}

export async function columnNames(
  journey: StoredNameJourney,
  table: string,
): Promise<readonly string[]> {
  const query =
    journey.database.kind === 'postgres'
      ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY column_name`
      : `SELECT name FROM pragma_table_info('${table}') ORDER BY name`;
  return (await rows(journey, query)).map((row) => String(row['name']));
}

export async function emit(journey: StoredNameJourney, psl: string, label: string): Promise<void> {
  writeFileSync(join(journey.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(journey);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

/** Brings the database to `psl` with the journey's command, then runs `seed`. */
export async function start(
  journey: StoredNameJourney,
  psl: string,
  seed: string,
  label: string,
): Promise<void> {
  await emit(journey, psl, label);
  if (journey.command === 'migration plan') {
    const initial = await planMigrationAndSelfEmit(journey, ['--name', 'initial']);
    expect(initial.exitCode, `${label}: plan initial: ${initial.stderr}`).toBe(0);
    const migrate = await runMigrate(journey);
    expect(migrate.exitCode, `${label}: migrate initial: ${migrate.stderr}`).toBe(0);
  } else {
    const create = await runDbUpdate(journey, ['--json']);
    expect(create.exitCode, `${label}: db update: ${create.stderr}`).toBe(0);
  }
  if (seed !== '') await execute(journey, seed);
}

/** Runs the journey's command for the emitted contract, from the database's migration when planning. */
export async function run(
  journey: StoredNameJourney,
  args: readonly string[],
): Promise<EngineCommandResult> {
  if (journey.command === 'migration plan') {
    return runMigrationPlan(journey, [
      '--from',
      latestMigrationDirName(journey),
      ...args,
      '--json',
    ]);
  }
  return runDbUpdate(journey, ['--no-interactive', ...args, '--json']);
}

/**
 * Plans and applies the emitted contract with the journey's command: `migration plan`, a re-run of the `migration.ts` it writes, and `db migrate`; or `db update`. Returns the operations planned.
 */
export async function planAndApply(
  journey: StoredNameJourney,
  args: readonly string[],
  label: string,
): Promise<readonly PlannedOperation[]> {
  const result = await run(journey, args);
  expect(
    result.exitCode,
    `${label}: ${journey.command}: ${result.stderr} ${JSON.stringify(engineError(result))}`,
  ).toBe(0);
  if (journey.command === 'db update') {
    return operationsOf(parseJsonOutput<{ plan: { operations: PlannedOperation[] } }>(result).plan);
  }
  const planned = operationsOf(parseJsonOutput<{ operations: PlannedOperation[] }>(result));
  const dir = join(journey.testDir, 'migrations', 'app', latestMigrationDirName(journey));
  await expectMigrationTsReproducesOps(journey, dir, label);
  const migrate = await runMigrate(journey);
  expect(migrate.exitCode, `${label}: migrate: ${migrate.stderr}`).toBe(0);
  return planned;
}

function operationsOf(plan: { operations: readonly PlannedOperation[] }): PlannedOperation[] {
  return plan.operations.map(({ label, operationClass }) => ({ label, operationClass }));
}

/** Runs the journey's command, expects it to fail, and returns the error with what does not depend on the run left out. */
export async function refusal(
  journey: StoredNameJourney,
  args: readonly string[],
  label: string,
): Promise<Diagnostic> {
  const count = getMigrationDirs(journey).length;
  const result = await run(journey, args);
  expect(result.exitCode, `${label}: ${journey.command} is refused`).not.toBe(0);
  expect(getMigrationDirs(journey), `${label}: nothing written`).toHaveLength(count);
  const error = engineError(result);
  if (error === undefined) throw new Error(`${label}: no error: ${result.stderr}`);
  return error;
}

/** The database matches the contract, and the journey's command finds nothing left to plan. */
export async function expectSettled(journey: StoredNameJourney, label: string): Promise<void> {
  const verify = await runDbVerify(journey, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (journey.command === 'migration plan') {
    const count = getMigrationDirs(journey).length;
    const fresh = await runMigrationPlan(journey, [
      '--from',
      latestMigrationDirName(journey),
      '--json',
    ]);
    expect(fresh.exitCode, `${label}: a further plan: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: it is empty`).toBe(true);
    expect(getMigrationDirs(journey), `${label}: nothing written`).toHaveLength(count);
    return;
  }
  const dryRun = await runDbUpdate(journey, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

/** The source of the `migration.ts` the last `migration plan` wrote. */
export function latestMigrationSource(journey: StoredNameJourney): string {
  return readFileSync(
    join(journey.testDir, 'migrations', 'app', latestMigrationDirName(journey), 'migration.ts'),
    'utf-8',
  );
}

export function dump(label: string, value: unknown): void {
  const dir = join(__dirname, '../../../../wip/stored-name-renames/out/d5-dump');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${label.replace(/[^\w.-]+/g, '_')}.json`),
    JSON.stringify(value, null, 2),
  );
}
