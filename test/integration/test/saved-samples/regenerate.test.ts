/**
 * Writes a new saved sample set with this branch's code. `vitest.config.ts` leaves it out of every test run unless `WRITE_SAVED_SAMPLES` is set, which `pnpm samples:write` does; `REGENERATE_SAVED_SAMPLES` names the release. It never writes into a set that exists. The procedure is in this folder's README.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { DeclaredDatabasePolicies } from '@internal/framework-components/control';
import { writeRef } from '@internal/migration-tools/refs';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { BSON, type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { dirname, join } from 'pathe';
import { expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  injectMigrationSqlDbSetup,
  type JourneyContext,
  latestMigrationDirName,
  latestMigrationToHash,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
} from '../utils/journey-test-helpers';
import { mongoConfig, mongoSources, postgresConfig, postgresSources } from './generator-inputs';
import {
  assertPostgresSchemaSavable,
  computeChecksumsIn,
  connectionPlaceholder,
  databaseDirIn,
  mongoRecordCollection,
  postgresSchemaFile,
  projectDirIn,
  queryPathIn,
  type SampleDatabase,
  type SavedSchema,
  sampleChecksumsPath,
  sampleSetDir,
  samplesRoot,
  writeProjectConfig,
} from './sample-projects';

/** The release the new set is written for: the version that will ship this branch's code, which can be later than the root `package.json` version until the release is cut. */
const release = process.env['REGENERATE_SAVED_SAMPLES'] ?? '';

/** The policies the `production` ref declares, which `db migrate --to production` records on the marker. */
const productionPolicies: DeclaredDatabasePolicies = { change: ['migrate'] };

/** The generator writes a set into `sets/.unfinished-<release>/` and moves it to `sets/<release>/` only when every step succeeded, so a failed run leaves no partial set. */
const unfinishedPrefix = '.unfinished-';
const unfinishedSetDir = join(samplesRoot, `${unfinishedPrefix}${release}`);

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The project files a release writes, the contract source and the config the user wrote; the config keeps the placeholder for the connection string. */
function saveProjectFiles(
  ctx: JourneyContext,
  setDir: string,
  database: SampleDatabase,
  config: string,
): void {
  const kept = new Set([
    'contract.prisma',
    'contract.json',
    'contract.d.ts',
    'output',
    'migrations',
  ]);
  const projectDir = projectDirIn(setDir, database);
  for (const entry of readdirSync(ctx.testDir)) {
    if (kept.has(entry)) {
      cpSync(join(ctx.testDir, entry), join(projectDir, entry), { recursive: true });
    }
  }
  writeFileSync(join(projectDir, 'prisma.config.ts'), config);
}

async function emitAndPlan(
  ctx: JourneyContext,
  source: string,
  name: string,
  statements: readonly string[] = [],
): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), source);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit for ${name}: ${emit.stderr}`).toBe(0);
  const plan = await runMigrationPlan(ctx, ['--name', name, ...statements]);
  expect(plan.exitCode, `migration plan ${name}: ${plan.stdout}\n${plan.stderr}`).toBe(0);
}

async function migrate(ctx: JourneyContext, args: readonly string[] = []): Promise<void> {
  const migrated = await runMigrate(ctx, args);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
}

/** Fills the data migration `migration.plan` scaffolded, gives its data transform `invariantId`, and runs it to write `ops.json`. */
async function fillDataMigration(
  ctx: JourneyContext,
  invariantId: string,
  fill: (scaffold: string) => string,
): Promise<void> {
  const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
  const migrationTs = join(dir, 'migration.ts');
  const filled = fill(readFileSync(migrationTs, 'utf8')).replace(
    /(dataTransform\((?:\w+,\s*)?['"][\w.-]+['"]\s*,\s*\{\n)/,
    `$1  invariantId: '${invariantId}',\n`,
  );
  expect(filled, 'the data transform carries the invariant').toContain(invariantId);
  writeFileSync(migrationTs, filled);
  const selfEmit = await selfEmitMigration(ctx, ['--dir', dir, '--config', ctx.configPath]);
  expect(selfEmit.exitCode, `node migration.ts: ${selfEmit.stdout}\n${selfEmit.stderr}`).toBe(0);
  expect(readJsonFile(join(dir, 'migration.json'))).toMatchObject({
    providedInvariants: [invariantId],
  });
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Declares the `production` ref at the latest migration, requiring `invariantId` and declaring policies, and applies it so the marker records both. */
async function deployProduction(ctx: JourneyContext, invariantId: string): Promise<void> {
  await writeRef(join(ctx.testDir, 'migrations', 'app', 'refs'), 'production', {
    hash: latestMigrationToHash(ctx),
    invariants: [invariantId],
    policies: productionPolicies,
  });
  await migrate(ctx, ['--to', 'production', '--permit-policy-change']);
}

/** Saves how Prisma's tables on PostgreSQL were created and the rows they hold, one JSON file per table. */
async function savePostgresRecords(connectionString: string, dir: string): Promise<void> {
  await assertPostgresSchemaSavable(connectionString);
  await withClient(connectionString, async (client) => {
    const columns = await client.query(`
      SELECT c.table_name, c.column_name, c.is_nullable, c.column_default,
        (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
            AND a.attname = c.column_name) AS type
      FROM information_schema.columns c
      WHERE c.table_schema = 'prisma_contract'
      ORDER BY c.table_name, c.ordinal_position`);
    const keys = await client.query(`
      SELECT k.table_name, k.column_name
      FROM information_schema.table_constraints t
      JOIN information_schema.key_column_usage k
        ON k.constraint_schema = t.constraint_schema AND k.constraint_name = t.constraint_name
      WHERE t.table_schema = 'prisma_contract' AND t.constraint_type = 'PRIMARY KEY'
      ORDER BY k.table_name, k.ordinal_position`);
    const sequences = await client.query(`
      SELECT s.relname AS name, format_type(q.seqtypid, NULL) AS type,
        t.relname AS table, a.attname AS column
      FROM pg_class s
      JOIN pg_namespace n ON n.oid = s.relnamespace
      JOIN pg_sequence q ON q.seqrelid = s.oid
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE n.nspname = 'prisma_contract' AND s.relkind = 'S'
      ORDER BY s.relname`);

    const tableNames = [...new Set(columns.rows.map((row) => row.table_name as string))];
    const schema: SavedSchema = {
      tables: tableNames.map((name) => ({
        name,
        columns: columns.rows
          .filter((row) => row.table_name === name)
          .map((row) => ({
            name: row.column_name,
            type: row.type,
            nullable: row.is_nullable === 'YES',
            default: row.column_default,
          })),
        primaryKey: keys.rows
          .filter((row) => row.table_name === name)
          .map((row) => row.column_name),
      })),
      sequences: sequences.rows.map((row) => ({
        name: row.name,
        type: row.type,
        table: row.table,
        column: row.column,
      })),
    };
    writeJson(join(dir, postgresSchemaFile), schema);

    for (const table of schema.tables) {
      const order = table.primaryKey.map((column) => `"${column}"`).join(', ');
      const rows = await client.query(
        `SELECT to_jsonb(t) AS row FROM prisma_contract."${table.name}" t ORDER BY ${order}`,
      );
      writeJson(
        join(dir, `${table.name}.json`),
        rows.rows.map((row) => row.row),
      );
    }
  });
}

/** Saves the documents of Prisma's collection on MongoDB in canonical Extended JSON, which keeps their BSON types. */
async function saveMongoRecords(db: Db, dir: string): Promise<void> {
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

async function generatePostgres(createTempDir: () => string, setDir: string): Promise<void> {
  const database = await createDevDatabase();
  try {
    const ctx = writeProjectConfig(createTempDir(), postgresConfig, database.connectionString);
    await emitAndPlan(ctx, postgresSources.initial, 'initial');
    await migrate(ctx);
    await emitAndPlan(ctx, postgresSources.posts, 'add-posts');
    await migrate(ctx);
    await emitAndPlan(ctx, postgresSources.displayName, 'add-display-name', [
      '--backfill',
      'User.displayName',
    ]);
    await fillDataMigration(ctx, 'backfill-user-display-name', (scaffold) =>
      injectMigrationSqlDbSetup(scaffold)
        .replace(
          'createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter })',
          'createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] })',
        )
        .replace(
          "import postgresTarget from '@internal/target-postgres/runtime';",
          "import postgresTarget from '@internal/target-postgres/runtime';\nimport pgvector from '@internal/extension-pgvector/runtime';",
        )
        .replace(
          "() => placeholder('User.displayName:check')",
          "() => db.public.user.select('id').where((f, fns) => fns.eq(f.displayName, null)).limit(1)",
        )
        .replace(
          "() => placeholder('User.displayName:run')",
          "() => db.public.user.update({ displayName: 'unnamed' }).where((f, fns) => fns.eq(f.displayName, null))",
        ),
    );
    await deployProduction(ctx, 'backfill-user-display-name');

    saveProjectFiles(ctx, setDir, 'postgres', postgresConfig);
    await savePostgresRecords(database.connectionString, databaseDirIn(setDir, 'postgres'));
    writeJson(queryPathIn(setDir, 'postgres'), {
      model: 'User',
      table: 'user',
      row: { email: 'ada@example.com', role: 'ADMIN', displayName: 'Ada' },
    });
  } finally {
    await database.close();
  }
}

async function generateMongo(createTempDir: () => string, setDir: string): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
    ],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const client = new MongoClient(replSet.getUri());
  try {
    await client.connect();
    const dbName = 'saved_samples';
    const ctx = writeProjectConfig(createTempDir(), mongoConfig, replSet.getUri(dbName));
    await emitAndPlan(ctx, mongoSources.initial, 'initial');
    await migrate(ctx);
    await emitAndPlan(ctx, mongoSources.posts, 'add-posts');
    await migrate(ctx);
    await emitAndPlan(ctx, mongoSources.name, 'add-name', ['--backfill', 'User.name']);
    await fillDataMigration(ctx, 'backfill-user-name', (scaffold) =>
      scaffold.replace(/placeholder\(['"]User\.name:update['"]\)/, "{ $set: { name: 'unnamed' } }"),
    );
    await deployProduction(ctx, 'backfill-user-name');

    saveProjectFiles(ctx, setDir, 'mongo', mongoConfig);
    await saveMongoRecords(client.db(dbName), databaseDirIn(setDir, 'mongo'));
    writeJson(queryPathIn(setDir, 'mongo'), {
      root: 'users',
      row: { email: 'ada@example.com', role: 'ADMIN', name: 'Ada' },
    });
  } finally {
    await client.close();
    await replSet.stop();
  }
}

function writeSetReadme(setDir: string): void {
  writeFileSync(
    join(setDir, 'README.md'),
    `# Saved samples written by ${release}

These files and records were written on ${new Date().toISOString().slice(0, 10)} by the code of ${release}, with \`pnpm samples:write\` (see [the procedure](../../README.md)). \`../${release}.sha256\` lists every file with its SHA-256; once ${release} is released, neither changes.

- \`postgres/project/\`: a PostgreSQL project with the pgvector extension pack, and its \`prisma.config.ts\` with \`${connectionPlaceholder}\` where each run puts its connection string. Its contract has an enum, a relation with an index, and a vector column. It has three application migrations, the third a data migration that fills a new required column and provides an invariant, and the pgvector pack's own migrations, refs and snapshots. The \`production\` ref requires the invariant and declares database policies; \`db\` declares neither.
- \`postgres/database/\`: how Prisma's tables in \`prisma_contract\` were created (\`${postgresSchemaFile}\`) and their rows after \`db migrate --to production\`, one JSON file per table. The marker records the policies and the invariant.
- \`mongo/project/\`: a MongoDB project whose contract has an enum, a relation with an index and a required field filled by a data migration that provides an invariant, with its config, three migrations, refs and snapshots. The refs are as on PostgreSQL.
- \`mongo/database/\`: the documents of \`${mongoRecordCollection}\` after \`db migrate --to production\`, in canonical Extended JSON.
- \`<database>/query.json\`: the row the tests write and read back through the facade.
`,
  );
}

/** Removes the folders an earlier run left when it failed before moving its set into place. */
function removeUnfinishedSets(): void {
  for (const entry of readdirSync(samplesRoot)) {
    if (entry.startsWith(unfinishedPrefix)) {
      console.warn(
        `Removing sets/${entry}, left by an earlier run of the generator that failed before its set was complete.`,
      );
      rmSync(join(samplesRoot, entry), { recursive: true, force: true });
    }
  }
}

withTempDir(({ createTempDir }) => {
  it(
    `writes the saved sample set for ${release || '(no release named)'}`,
    async () => {
      if (release === '') {
        throw new Error(
          'Name the release the set is for: REGENERATE_SAVED_SAMPLES=<version> pnpm samples:write',
        );
      }
      removeUnfinishedSets();
      if (existsSync(sampleSetDir(release)) || existsSync(sampleChecksumsPath(release))) {
        throw new Error(
          `A saved sample set for ${release} exists. A saved set is never written over: it records what ${release} wrote. Write a set for the release that will ship this change instead.`,
        );
      }
      mkdirSync(unfinishedSetDir);
      await generatePostgres(createTempDir, unfinishedSetDir);
      await generateMongo(createTempDir, unfinishedSetDir);
      writeSetReadme(unfinishedSetDir);
      const checksums = computeChecksumsIn(unfinishedSetDir);
      renameSync(unfinishedSetDir, sampleSetDir(release));
      writeFileSync(sampleChecksumsPath(release), checksums);
    },
    timeouts.spinUpPpgDev + timeouts.spinUpMongoMemoryServer,
  );
});
