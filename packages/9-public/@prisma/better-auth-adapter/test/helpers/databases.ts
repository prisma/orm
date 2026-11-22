import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { SqlStorage } from '@prisma/orm-family-sql/contract/types';
import type { Contract } from '@prisma/orm-framework/contract/types';
import { defineConfig as postgresConfig } from '@prisma/orm-postgres/config';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson as postgresContractFromJson } from '@prisma/orm-postgres/static';
import { defineConfig as sqliteConfig } from '@prisma/orm-sqlite/config';
import { createSqliteControlClient } from '@prisma/orm-sqlite/control';
import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson as sqliteContractFromJson } from '@prisma/orm-sqlite/static';
import { join } from 'pathe';
import pg from 'pg';

export type SqlContract = Contract<SqlStorage>;

export type TargetName = 'sqlite' | 'postgres';

export const targets: readonly TargetName[] = ['sqlite', 'postgres'];

/** A directory under the operating system's temporary directory that holds every file a test file writes. */
export interface WorkDir {
  readonly path: string;
  nextPath(prefix: string): string;
  remove(): Promise<void>;
}

export async function createWorkDir(): Promise<WorkDir> {
  const path = await mkdtemp(join(tmpdir(), 'prisma-better-auth-adapter-'));
  let counter = 0;
  return {
    path,
    nextPath(prefix) {
      counter += 1;
      return join(path, `${prefix}-${counter}`);
    },
    remove: () => rm(path, { recursive: true, force: true }),
  };
}

export interface EmittedContract {
  readonly json: unknown;
  readonly contract: SqlContract;
}

function configFor(target: TargetName, contractPath: string) {
  return target === 'sqlite'
    ? sqliteConfig({ contract: contractPath })
    : postgresConfig({ contract: contractPath });
}

function controlClientFor(target: TargetName, connection?: string) {
  const options = connection === undefined ? {} : { connection };
  return target === 'sqlite'
    ? createSqliteControlClient(options)
    : createPostgresControlClient(options);
}

/** Emits PSL text in memory with the control client, as `prisma contract emit` does. */
export async function emitContract(
  target: TargetName,
  psl: string,
  workDir: WorkDir,
): Promise<EmittedContract> {
  const dir = workDir.nextPath(`psl-${target}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'contract.prisma');
  await writeFile(file, psl);
  const contractConfig = configFor(target, file).contract;
  if (contractConfig?.typesModule === undefined) throw new Error('The config has no contract');
  const emitted = await controlClientFor(target).emit({
    contractConfig: {
      source: contractConfig.source,
      output: join(dir, 'contract.json'),
      typesModule: contractConfig.typesModule,
    },
  });
  if (!emitted.ok) {
    throw new Error(
      `Emitting this PSL failed:\n${psl}\n${JSON.stringify(emitted.failure, null, 2)}`,
    );
  }
  const json: unknown = JSON.parse(emitted.value.contractJson);
  const contract =
    target === 'sqlite'
      ? sqliteContractFromJson<SqlContract>(json)
      : postgresContractFromJson<SqlContract>(json);
  return { json, contract };
}

/** Creates every table of a contract in an empty database, as `prisma db init` does. */
export async function applyContract(
  target: TargetName,
  json: unknown,
  connection: string,
  workDir: WorkDir,
): Promise<void> {
  const migrationsDir = workDir.nextPath('migrations');
  await mkdir(migrationsDir, { recursive: true });
  const control = controlClientFor(target, connection);
  try {
    const init = await control.dbInit({
      invocation: { cwd: workDir.path, configPath: undefined, dbGiven: false },
      contract: json,
      mode: 'apply',
      migrationsDir,
    });
    if (!init.ok) {
      throw new Error(`Applying the contract failed:\n${JSON.stringify(init.failure, null, 2)}`);
    }
  } finally {
    await control.close();
  }
}

export function openSqliteClient(json: unknown, path: string) {
  return sqlite({ contract: sqliteContractFromJson<SqlContract>(json), path });
}

export function openPostgresClient(json: unknown, url: string) {
  return postgres({ contract: postgresContractFromJson<SqlContract>(json), url });
}

/** Drops every schema the tests may have created and recreates an empty `public`. */
export async function resetPostgres(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `select nspname from pg_namespace
       where nspname not like 'pg\\_%'
         and nspname <> 'information_schema'
         and nspname not like '\\_prisma\\_dev%'`,
    );
    for (const { nspname } of rows) {
      await client.query(`drop schema if exists "${nspname}" cascade`);
    }
    await client.query('create schema public');
  } finally {
    await client.end();
  }
}
