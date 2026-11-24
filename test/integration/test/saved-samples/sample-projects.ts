import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withClient } from '@repo/test-utils';
import { BSON, type Db } from 'mongodb';
import { dirname, join, relative } from 'pathe';
import { writeProjectManifest } from '../utils/cli-test-helpers';
import type { JourneyContext } from '../utils/journey-test-helpers';

export type SampleDatabase = 'postgres' | 'mongo';

/** The folder holding each saved set, `<release>/`, and its checksum list, `<release>.sha256`. */
export const samplesRoot = join(dirname(fileURLToPath(import.meta.url)), 'sets');

/** Each release that has a saved sample set, named by its version. */
export function savedReleases(): string[] {
  return readdirSync(samplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function sampleSetDir(release: string): string {
  return join(samplesRoot, release);
}

/** The list of every file in a set with its SHA-256, kept beside the set. */
export function sampleChecksumsPath(release: string): string {
  return join(samplesRoot, `${release}.sha256`);
}

/** The files of a project as `release` wrote them, with the config its user wrote. */
export function sampleProjectDir(release: string, database: SampleDatabase): string {
  return join(samplesRoot, release, database, 'project');
}

/** Prisma's own database records as `release` wrote them. */
export function sampleDatabaseDir(release: string, database: SampleDatabase): string {
  return join(samplesRoot, release, database, 'database');
}

/** The row a test writes and reads back through the facade, as the set's contract describes it. */
export function sampleQueryPath(release: string, database: SampleDatabase): string {
  return join(samplesRoot, release, database, 'query.json');
}

export function sampleSetExists(release: string, database: SampleDatabase): boolean {
  return existsSync(join(samplesRoot, release, database));
}

/** The placeholder a saved `prisma.config.ts` holds where each run puts its connection string. */
export const connectionPlaceholder = '{{DB_URL}}';

/** Where the project's emitted `contract.json` is, relative to the project. */
export const emittedContractPath: Record<SampleDatabase, string> = {
  postgres: 'contract.json',
  mongo: 'output/contract.json',
};

/** Writes `config` into the project with the placeholder replaced by `connectionString`, and the manifest beside it. */
export function writeProjectConfig(
  testDir: string,
  config: string,
  connectionString: string,
): JourneyContext {
  writeProjectManifest(testDir);
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    config.replace(connectionPlaceholder, () => connectionString),
  );
  return { testDir, configPath, outputDir: join(testDir, 'output') };
}

/** A copy of a saved project in `testDir`, its config pointing at `connectionString`, so a test never changes the saved files. */
export function copySampleProject(
  release: string,
  database: SampleDatabase,
  testDir: string,
  connectionString: string,
): JourneyContext {
  cpSync(sampleProjectDir(release, database), testDir, { recursive: true });
  return writeProjectConfig(
    testDir,
    readFileSync(join(testDir, 'prisma.config.ts'), 'utf8'),
    connectionString,
  );
}

/** The migration spaces of a saved project: every folder under `migrations/` but the snapshots. */
export function sampleSpaces(release: string, database: SampleDatabase): string[] {
  return readdirSync(join(sampleProjectDir(release, database), 'migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory() && entry.name !== 'snapshots')
    .map((entry) => entry.name)
    .sort();
}

export function readSampleJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** Every file of a set with its SHA-256, one `<hash>  <path>` line per file, as `sha256sum` writes them. */
export function computeSampleChecksums(release: string): string {
  const dir = sampleSetDir(release);
  return filesUnder(dir)
    .map((file) => {
      const hash = createHash('sha256')
        .update(readFileSync(join(dir, file)))
        .digest('hex');
      return `${hash}  ${file}\n`;
    })
    .join('');
}

/** A table of Prisma's on PostgreSQL as a release created it. */
export interface SavedTable {
  readonly name: string;
  readonly columns: readonly {
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly default: string | null;
  }[];
  readonly primaryKey: readonly string[];
}

/** A sequence in Prisma's schema on PostgreSQL, and the column that owns it. */
export interface SavedSequence {
  readonly name: string;
  readonly type: string;
  readonly table: string;
  readonly column: string;
}

/** How a release created Prisma's tables on PostgreSQL, saved as `tables.json` beside their rows. */
export interface SavedSchema {
  readonly tables: readonly SavedTable[];
  readonly sequences: readonly SavedSequence[];
}

export const postgresSchemaFile = 'tables.json';

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const qualified = (name: string) => `prisma_contract.${quote(name)}`;

/**
 * Replaces Prisma's schema on PostgreSQL with the tables a release created, as its `tables.json` describes them, holding the rows it saved. The current release then runs against the tables as that release left them.
 */
export async function restorePostgresRecords(connectionString: string, dir: string): Promise<void> {
  const schema = readSampleJson(join(dir, postgresSchemaFile)) as SavedSchema;
  await withClient(connectionString, async (client) => {
    await client.query('DROP SCHEMA prisma_contract CASCADE');
    await client.query('CREATE SCHEMA prisma_contract');
    for (const sequence of schema.sequences) {
      await client.query(`CREATE SEQUENCE ${qualified(sequence.name)} AS ${sequence.type}`);
    }
    for (const table of schema.tables) {
      const columns = table.columns.map(
        (column) =>
          `${quote(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}${
            column.default === null ? '' : ` DEFAULT ${column.default}`
          }`,
      );
      const primaryKey = `PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`;
      await client.query(
        `CREATE TABLE ${qualified(table.name)} (${[...columns, primaryKey].join(', ')})`,
      );
      await client.query(
        `INSERT INTO ${qualified(table.name)} SELECT * FROM jsonb_populate_recordset(NULL::${qualified(table.name)}, $1::jsonb)`,
        [readFileSync(join(dir, `${table.name}.json`), 'utf8')],
      );
    }
    for (const sequence of schema.sequences) {
      const owner = `${qualified(sequence.table)}.${quote(sequence.column)}`;
      await client.query(`ALTER SEQUENCE ${qualified(sequence.name)} OWNED BY ${owner}`);
      await client.query(
        `SELECT setval('${qualified(sequence.name)}', COALESCE(MAX(${quote(sequence.column)}), 0) + 1, false) FROM ${qualified(sequence.table)}`,
      );
    }
  });
}

/** The rows of a table of Prisma's on PostgreSQL, each as JSON. */
export async function readPostgresRows(
  connectionString: string,
  table: string,
): Promise<Record<string, unknown>[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(`SELECT to_jsonb(t) AS row FROM ${qualified(table)} t`);
    return result.rows.map((row) => row.row);
  });
}

export const mongoRecordCollection = '_prisma_migrations';

export function readMongoRecords(dir: string): Record<string, unknown>[] {
  const documents = BSON.EJSON.parse(
    readFileSync(join(dir, `${mongoRecordCollection}.json`), 'utf8'),
    { relaxed: false },
  );
  if (!Array.isArray(documents)) {
    throw new Error(`${mongoRecordCollection}.json does not hold an array of documents`);
  }
  return documents;
}

/** Replaces the documents of Prisma's collection on MongoDB with the saved ones. */
export async function loadMongoRecords(db: Db, dir: string): Promise<void> {
  await db.collection(mongoRecordCollection).deleteMany({});
  await db.collection(mongoRecordCollection).insertMany(readMongoRecords(dir));
}
