import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withClient } from '@repo/test-utils';
import { BSON, type Db } from 'mongodb';
import { dirname, join } from 'pathe';
import { writeProjectManifest } from '../utils/cli-test-helpers';
import type { JourneyContext } from '../utils/journey-test-helpers';

export type SampleDatabase = 'postgres' | 'mongo';

export const samplesRoot = dirname(fileURLToPath(import.meta.url));

/** Each release that has a saved sample set, named by its version. */
export function savedReleases(): string[] {
  return readdirSync(samplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** The files of a project as `release` wrote them. */
export function sampleProjectDir(release: string, database: SampleDatabase): string {
  return join(samplesRoot, release, database, 'project');
}

/** Prisma's own database records as `release` wrote them. */
export function sampleDatabaseDir(release: string, database: SampleDatabase): string {
  return join(samplesRoot, release, database, 'database');
}

/** The Prisma tables on PostgreSQL whose rows a sample set saves, each with the order its rows are saved in. */
export const postgresRecordTables = {
  marker: 'space',
  ledger: 'id',
  contract: 'core_hash',
} as const;

export type PostgresRecordTable = keyof typeof postgresRecordTables;

export const mongoRecordCollection = '_prisma_migrations';

/**
 * The project's config. A release does not write it, so the samples leave it out and each run writes it pointing at its own database.
 */
const configs: Record<SampleDatabase, string> = {
  postgres: `import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
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
    extensions: [pgvector],
    contract: {
      ...prismaContract('./contract.prisma', {
        output: 'contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: '@internal/postgres/contract-types',
    },
    db: { connection: '{{DB_URL}}' },
    migrations: { dir: 'migrations', module: '@internal/postgres/migration' },
  }),
});
`,
  mongo: `import { defineConfig as mongo } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: mongo({
    contract: './contract.prisma',
    output: 'output',
    db: { connection: '{{DB_URL}}' },
  }),
});
`,
};

/** Writes the project's config, pointing at `connectionString`. */
export function writeSampleConfig(
  testDir: string,
  database: SampleDatabase,
  connectionString: string,
): string {
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    configs[database].replace('{{DB_URL}}', () => connectionString),
  );
  return configPath;
}

/** Where the project's emitted `contract.json` is, relative to the project. */
export const emittedContractPath: Record<SampleDatabase, string> = {
  postgres: 'contract.json',
  mongo: 'output/contract.json',
};

/** A new project in `testDir` with its config and manifest, and no other files. */
export function emptySampleProject(
  testDir: string,
  database: SampleDatabase,
  connectionString: string,
): JourneyContext {
  writeProjectManifest(testDir);
  const configPath = writeSampleConfig(testDir, database, connectionString);
  return { testDir, configPath, outputDir: join(testDir, 'output') };
}

/** A copy of a saved project in `testDir`, so a test never changes the saved files. */
export function copySampleProject(
  release: string,
  database: SampleDatabase,
  testDir: string,
  connectionString: string,
): JourneyContext {
  cpSync(sampleProjectDir(release, database), testDir, { recursive: true });
  return emptySampleProject(testDir, database, connectionString);
}

export function readSampleJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Saves the rows of each Prisma table on PostgreSQL, one JSON file per table. */
export async function savePostgresRecords(connectionString: string, dir: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    for (const [table, order] of Object.entries(postgresRecordTables)) {
      const result = await client.query(
        `SELECT to_jsonb(t) AS row FROM prisma_contract.${table} t ORDER BY ${order}`,
      );
      writeJson(
        join(dir, `${table}.json`),
        result.rows.map((row) => row.row),
      );
    }
  });
}

/** Replaces the rows of each Prisma table on PostgreSQL with the saved ones. */
export async function loadPostgresRecords(connectionString: string, dir: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    for (const table of Object.keys(postgresRecordTables)) {
      const rows = readFileSync(join(dir, `${table}.json`), 'utf8');
      await client.query(`DELETE FROM prisma_contract.${table}`);
      await client.query(
        `INSERT INTO prisma_contract.${table} SELECT * FROM jsonb_populate_recordset(NULL::prisma_contract.${table}, $1::jsonb)`,
        [rows],
      );
    }
  });
}

/** Saves the documents of Prisma's collection on MongoDB in canonical Extended JSON, which keeps their BSON types. */
export async function saveMongoRecords(db: Db, dir: string): Promise<void> {
  const documents = await db
    .collection(mongoRecordCollection)
    .find({}, { sort: { _id: 1 } })
    .toArray();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${mongoRecordCollection}.json`),
    `${BSON.EJSON.stringify(documents, undefined, 2, { relaxed: false })}\n`,
  );
}

/** Replaces the documents of Prisma's collection on MongoDB with the saved ones. */
export async function loadMongoRecords(db: Db, dir: string): Promise<void> {
  const documents = BSON.EJSON.parse(
    readFileSync(join(dir, `${mongoRecordCollection}.json`), 'utf8'),
    { relaxed: false },
  );
  if (!Array.isArray(documents)) {
    throw new Error(`${mongoRecordCollection}.json does not hold an array of documents`);
  }
  await db.collection(mongoRecordCollection).deleteMany({});
  await db.collection(mongoRecordCollection).insertMany(documents);
}

export function sampleSetExists(release: string, database: SampleDatabase): boolean {
  return existsSync(join(samplesRoot, release, database));
}
