/**
 * A project for the database-policy journeys, on any of the four targets: a PSL contract with a
 * base and a next version, a config pointing at the test's database, and readers for the marker
 * and the ledger the CLI wrote.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ContractMarkerRecord } from '@internal/contract/types';
import type { DeclaredDatabasePolicies } from '@internal/framework-components/control';
import { readRef, writeRef } from '@internal/migration-tools/refs';
import { createMongoControlClient } from '@internal/mongo/control';
import { createMysqlControlClient } from '@internal/mysql/control';
import { createPostgresControlClient } from '@internal/postgres/control';
import { createSqliteControlClient } from '@internal/sqlite/control';
import { withClient } from '@repo/test-utils';
import { queryMysqlDatabase } from '@repo/test-utils/mysql-database';
import { MongoClient } from 'mongodb';
import { join } from 'pathe';
import { expect } from 'vitest';
import { writeProjectManifest } from './cli-test-helpers';
import {
  type EngineCommandResult,
  getLatestMigrationDir,
  type JourneyContext,
  mysqlPslConfigFixture,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSchema,
  runMigrationLog,
  sqlitePslConfigFixture,
} from './journey-test-helpers';

export type ContractVersion = 'base' | 'next' | 'unique';

export type PolicyTarget = 'postgres' | 'sqlite' | 'mysql' | 'mongo';

export interface PolicyProject {
  readonly target: PolicyTarget;
  readonly ctx: JourneyContext;
  /** The connection string, or for SQLite the database file. */
  readonly connection: string;
}

const SQL_CONTRACTS = {
  base: `// use prisma-8

model User {
  id    Int    @id
  email String

  @@map("user")
}
`,
  next: `// use prisma-8

model User {
  id    Int     @id
  email String
  name  String?

  @@map("user")
}
`,
  unique: `// use prisma-8

model User {
  id    Int     @id
  email String  @unique
  name  String?

  @@map("user")
}
`,
};

const MONGO_CONTRACTS = {
  base: `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String

  @@map("users")
}
`,
  next: `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String
  name  String?

  @@map("users")
}
`,
  unique: `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  name  String?

  @@map("users")
}
`,
};

const POSTGRES_CONFIG = `import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
    contract: prismaContract('./contract.prisma', {
      output: 'contract.json',
      target: postgres,
      createNamespace: postgresCreateNamespace,
    }),
    db: { connection: {{CONNECTION}} },
    migrations: { dir: 'migrations' },
  }),
});
`;

const MONGO_CONFIG = `import { defineConfig as ormConfig } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    output: 'output',
    db: { connection: {{CONNECTION}} },
  }),
});
`;

function configFor(target: PolicyTarget, connection: string): string {
  switch (target) {
    case 'postgres':
      return POSTGRES_CONFIG.replace('{{CONNECTION}}', () => JSON.stringify(connection));
    case 'mongo':
      return MONGO_CONFIG.replace('{{CONNECTION}}', () => JSON.stringify(connection));
    case 'sqlite':
      return readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => connection);
    case 'mysql':
      return readFileSync(mysqlPslConfigFixture, 'utf-8').replace('{{DB_URL}}', () => connection);
  }
}

/** A project in `testDir` whose config points at `connection` and whose contract is the base version, not yet emitted. */
export function setupPolicyProject(
  target: PolicyTarget,
  testDir: string,
  connection: string,
): PolicyProject {
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, configFor(target, connection), 'utf-8');
  writeProjectManifest(testDir);
  const project = {
    target,
    ctx: { testDir, configPath, outputDir: testDir },
    connection,
  };
  writeContract(project, 'base');
  return project;
}

export function writeContract(project: PolicyProject, version: ContractVersion): void {
  const contracts = project.target === 'mongo' ? MONGO_CONTRACTS : SQL_CONTRACTS;
  writeFileSync(join(project.ctx.testDir, 'contract.prisma'), contracts[version], 'utf-8');
}

/** Emits `version` and plans a migration to it from the latest migration, returning the contract it ends at. */
export async function planTo(
  project: PolicyProject,
  version: ContractVersion,
  name: string,
): Promise<string> {
  const previous = getLatestMigrationDir(project.ctx);
  writeContract(project, version);
  const emitted = await runContractEmit(project.ctx);
  expect(emitted.exitCode, `emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
  const planned = await planMigrationAndSelfEmit(project.ctx, [
    '--name',
    name,
    ...(previous === undefined ? [] : ['--from', previous]),
  ]);
  expect(planned.exitCode, `plan ${name}: ${planned.stdout}\n${planned.stderr}`).toBe(0);
  return latestMigrationTo(project);
}

export function latestMigrationTo(project: PolicyProject): string {
  const dir = getLatestMigrationDir(project.ctx) ?? '';
  const manifest = JSON.parse(
    readFileSync(join(project.ctx.testDir, 'migrations', 'app', dir, 'migration.json'), 'utf-8'),
  ) as { readonly to: string };
  return manifest.to;
}

export function appRefsDir(project: PolicyProject): string {
  return join(project.ctx.testDir, 'migrations', 'app', 'refs');
}

/** Writes ref `name` at `hash`, declaring `policies`. */
export async function writePolicyRef(
  project: PolicyProject,
  name: string,
  hash: string,
  policies: DeclaredDatabasePolicies,
  invariants: readonly string[] = [],
): Promise<void> {
  await writeRef(appRefsDir(project), name, { hash, invariants, policies });
}

export function readPolicyRef(project: PolicyProject, name: string) {
  return readRef(appRefsDir(project), name);
}

function controlClient(project: PolicyProject) {
  switch (project.target) {
    case 'postgres':
      return createPostgresControlClient();
    case 'sqlite':
      return createSqliteControlClient();
    case 'mysql':
      return createMysqlControlClient();
    case 'mongo':
      return createMongoControlClient();
  }
}

/** The application space's marker, as the database holds it. */
export async function appMarker(project: PolicyProject): Promise<ContractMarkerRecord | undefined> {
  const client = controlClient(project);
  try {
    await client.connect(project.connection);
    return (await client.readAllMarkers()).get('app');
  } finally {
    await client.close();
  }
}

/** How many ledger entries `migration log` lists. */
export async function ledgerLength(project: PolicyProject): Promise<number> {
  const logged = await runMigrationLog(project.ctx, ['--json']);
  expect(logged.exitCode, `migration log: ${logged.stdout}\n${logged.stderr}`).toBe(0);
  return parseJsonOutput<{ readonly records: readonly unknown[] }>(logged).records.length;
}

/** The error envelope of a failed `--json` run. */
export function errorOf(run: EngineCommandResult): Record<string, unknown> {
  expect(run.exitCode, `expected a failure: ${run.stdout}\n${run.stderr}`).not.toBe(0);
  return parseJsonOutput(run);
}

export const MIGRATE_ONLY_DECLARED: DeclaredDatabasePolicies = { change: ['migrate'] };

/** What the marker records after a run consents to {@link MIGRATE_ONLY_DECLARED} on a database with no policies. */
export const MIGRATE_ONLY_RECORDED = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-with-consent',
    accessWidening: 'access-widening-with-consent',
  },
};

/** Two users with the same email, so a migration that makes email unique fails on them. */
export async function insertDuplicateUsers(project: PolicyProject): Promise<void> {
  switch (project.target) {
    case 'postgres':
      await withClient(project.connection, (client) =>
        client.query(`insert into "user" (id, email) values (1, 'a@x.io'), (2, 'a@x.io')`),
      );
      return;
    case 'sqlite': {
      const db = new DatabaseSync(project.connection);
      try {
        db.exec(`insert into "user" (id, email) values (1, 'a@x.io'), (2, 'a@x.io')`);
      } finally {
        db.close();
      }
      return;
    }
    case 'mysql':
      await queryMysqlDatabase(
        project.connection,
        "insert into `user` (id, email) values (1, 'a@x.io'), (2, 'a@x.io')",
      );
      return;
    case 'mongo': {
      const client = new MongoClient(project.connection);
      try {
        await client.connect();
        await client
          .db()
          .collection('users')
          .insertMany([{ email: 'a@x.io' }, { email: 'a@x.io' }]);
      } finally {
        await client.close();
      }
      return;
    }
  }
}

/** The database's schema, as `db schema --json` reports it. */
export async function schemaOf(project: PolicyProject): Promise<unknown> {
  const shown = await runDbSchema(project.ctx, ['--json']);
  expect(shown.exitCode, `db schema: ${shown.stdout}\n${shown.stderr}`).toBe(0);
  const { timings: _timings, ...schema } = parseJsonOutput<{ readonly timings?: unknown }>(shown);
  return schema;
}
