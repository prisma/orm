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

/** The files of a project in the set in `setDir`, with the config its user wrote. */
export function projectDirIn(setDir: string, database: SampleDatabase): string {
  return join(setDir, database, 'project');
}

/** Prisma's own database records in the set in `setDir`. */
export function databaseDirIn(setDir: string, database: SampleDatabase): string {
  return join(setDir, database, 'database');
}

/** The row a test writes and reads back through the facade, as the contract of the set in `setDir` describes it. */
export function queryPathIn(setDir: string, database: SampleDatabase): string {
  return join(setDir, database, 'query.json');
}

export function sampleProjectDir(release: string, database: SampleDatabase): string {
  return projectDirIn(sampleSetDir(release), database);
}

export function sampleDatabaseDir(release: string, database: SampleDatabase): string {
  return databaseDirIn(sampleSetDir(release), database);
}

export function sampleQueryPath(release: string, database: SampleDatabase): string {
  return queryPathIn(sampleSetDir(release), database);
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

/** Every file of the set in `dir` with its SHA-256, one `<hash>  <path>` line per file, as `sha256sum` writes them. */
export function computeChecksumsIn(dir: string): string {
  return filesUnder(dir)
    .map((file) => {
      const hash = createHash('sha256')
        .update(readFileSync(join(dir, file)))
        .digest('hex');
      return `${hash}  ${file}\n`;
    })
    .join('');
}

export function computeSampleChecksums(release: string): string {
  return computeChecksumsIn(sampleSetDir(release));
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

/** The schema of the function the in-process dev server's own trigger on every table calls to record changes; that trigger is the server's, not a release's. */
const devServerChangeCaptureSchema = '_prisma_dev_wal';

const unsavedPostgresObjectsQuery = `
  WITH tables AS (
    SELECT c.oid, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'prisma_contract' AND c.relkind = 'r'
  )
  SELECT format('index %s on %s', ic.relname, t.relname) AS object
    FROM pg_index i JOIN tables t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE NOT i.indisprimary
  UNION ALL
  SELECT format('constraint %s (type %s) on %s', con.conname, con.contype, t.relname)
    FROM pg_constraint con JOIN tables t ON t.oid = con.conrelid
    WHERE con.contype NOT IN ('p', 'n')
  UNION ALL
  SELECT format('identity column %s.%s', t.relname, a.attname)
    FROM pg_attribute a JOIN tables t ON t.oid = a.attrelid
    WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attidentity <> ''
  UNION ALL
  SELECT format('generated column %s.%s', t.relname, a.attname)
    FROM pg_attribute a JOIN tables t ON t.oid = a.attrelid
    WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> ''
  UNION ALL
  SELECT format('sequence %s, not owned by a serial column', s.relname)
    FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE n.nspname = 'prisma_contract' AND s.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d JOIN tables t ON t.oid = d.refobjid
        WHERE d.objid = s.oid AND d.deptype = 'a'
      )
  UNION ALL
  SELECT format('trigger %s on %s', tg.tgname, t.relname)
    FROM pg_trigger tg JOIN tables t ON t.oid = tg.tgrelid
    JOIN pg_proc p ON p.oid = tg.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT tg.tgisinternal AND pn.nspname <> $1
  UNION ALL
  SELECT format('%s %s', CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE format('relation of kind %s', c.relkind) END, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'prisma_contract' AND c.relkind NOT IN ('r', 'i', 'S')
  ORDER BY object`;

/**
 * Refuses Prisma's schema on PostgreSQL when it holds anything `tables.json` does not record (columns, their defaults and not-null, primary keys, and the sequences of `serial` columns), so a set never describes tables its release did not create.
 */
export async function assertPostgresSchemaSavable(connectionString: string): Promise<void> {
  const unsaved = await withClient(connectionString, async (client) => {
    const result = await client.query<{ object: string }>(unsavedPostgresObjectsQuery, [
      devServerChangeCaptureSchema,
    ]);
    return result.rows.map((row) => row.object);
  });
  if (unsaved.length > 0) {
    throw new Error(
      `Prisma's schema prisma_contract holds what ${postgresSchemaFile} does not record: ${unsaved.join('; ')}. The generator must learn to save and restore these before it writes this set.`,
    );
  }
}

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
