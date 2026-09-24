/**
 * Mongo migration authoring journey (CLI end-to-end).
 *
 * Covers the gap that no Postgres-shaped journey test exercises for MongoDB:
 *
 *  1. `migration plan --target mongo` from the empty contract baseline:
 *     scaffolds a `migration.ts`, populates the migrations root's
 *     content-addressed `migrations/snapshots/<hex>/contract.{json,d.ts}`
 *     store entry for the destination contract, and emits attested
 *     `ops.json` with the expected `createIndex` operation(s). Asserts the
 *     rendered `migration.ts` is round-trip executable: running its class-flow
 *     instantiates the migration class, reads its `operations` getter, and
 *     self-emits `ops.json` + attested `migration.json`.
 *
 *  2. `migration new --target mongo` after a contract change: scaffolds an
 *     empty `Migration` subclass stub for hand-authoring (with the contract
 *     bookends populated in `describe()`) and populates the destination
 *     contract's store entry.
 *
 *  3. End-to-end with a real MongoDB instance via
 *     `MongoMemoryReplSet`: plan + apply the initial DDL, seed data,
 *     hand-author a `dataTransform` + additive `createIndex` migration,
 *     self-emit it by running `node migration.ts`, apply it, and verify both
 *     the structural change and the data transformation took effect against
 *     the live database.
 */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { storageHashHex } from '@prisma/orm-mongo/components/control';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationToHash,
  migrationStatusAppSpace,
  parseJsonOutput,
  parseMigrationStatusJson,
  runContractEmit,
  runMigrate,
  runMigrationNew,
  runMigrationPlan,
  runMigrationStatus,
  selfEmitMigration,
} from '../utils/journey-test-helpers';

const INVARIANT_ID = 'lowercase-user-name';

/** Writes a ref pointing at `hash` and requiring `invariants` (moved from the deleted invariant-routing.mongo mirror). */
function writeRefFile(
  ctx: JourneyContext,
  name: string,
  hash: string,
  invariants: readonly string[],
): void {
  const refsDir = join(ctx.testDir, 'migrations', 'app', 'refs');
  mkdirSync(refsDir, { recursive: true });
  writeFileSync(
    join(refsDir, `${name}.json`),
    `${JSON.stringify({ hash, invariants }, null, 2)}\n`,
    'utf-8',
  );
}

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

function setupMongoJourney(connectionString: string | undefined): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });

  // The journey's project states the one package it installs. Emission reads
  // the nearest manifest to decide which names generated files carry, and
  // without this the temp directory would inherit the shared fixture app's,
  // which lists the whole workspace and looks nothing like a user's project.
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify(
      {
        name: 'mongo-journey-app',
        private: true,
        type: 'module',
        dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
      },
      null,
      2,
    ),
    'utf-8',
  );

  copyFileSync(join(FIXTURES_DIR, 'contract-base.ts'), join(testDir, 'contract.ts'));

  let configContent = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8');
  configContent = configContent.replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString ?? 'mongodb://localhost:27017/unused',
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  return { testDir, configPath, outputDir };
}

function swapToAdditive(ctx: JourneyContext): void {
  copyFileSync(join(FIXTURES_DIR, 'contract-additive.ts'), join(ctx.testDir, 'contract.ts'));
}

function getLatestMigrationDir(ctx: JourneyContext): string {
  const migrationsDir = join(ctx.testDir, 'migrations', 'app');
  const dirs = readdirSync(migrationsDir).filter((d) => !d.startsWith('.'));
  if (dirs.length === 0) throw new Error('No migration directory found');
  let newest = dirs[0]!;
  let newestMtime = statSync(join(migrationsDir, newest)).mtimeMs;
  for (let i = 1; i < dirs.length; i++) {
    const dir = dirs[i]!;
    const mtime = statSync(join(migrationsDir, dir)).mtimeMs;
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newest = dir;
    }
  }
  return join(migrationsDir, newest);
}

/**
 * `MongoMemoryReplSet.getUri()` returns a URI without an explicit database
 * name (and may carry query parameters such as `?replicaSet=...`). The CLI
 * needs a connection string that points at a specific database, so splice
 * the database name into the path component while preserving the query.
 */
function buildMongoUri(baseUri: string, dbName: string): string {
  const [hostPart, query] = baseUri.split('?');
  const trimmedHost = (hostPart ?? '').replace(/\/?$/, '/');
  return query ? `${trimmedHost}${dbName}?${query}` : `${trimmedHost}${dbName}`;
}

function findMigrationDirBySlug(ctx: JourneyContext, slugFragment: string): string {
  const migrationsDir = join(ctx.testDir, 'migrations', 'app');
  const dirs = readdirSync(migrationsDir)
    .filter((d) => !d.startsWith('.') && d.includes(slugFragment))
    .sort();
  const match = dirs[dirs.length - 1];
  if (!match) {
    throw new Error(`No migration directory found containing '${slugFragment}'`);
  }
  return join(migrationsDir, match);
}

/** Path to a `migrations/snapshots/<hex>/contract.{json,d.ts}` store entry. */
function contractSnapshotPath(
  ctx: JourneyContext,
  storageHash: string,
  file: 'contract.json' | 'contract.d.ts',
): string {
  return join(ctx.testDir, 'migrations', 'snapshots', storageHashHex(storageHash), file);
}

// Journey tests run multi-step CLI flows, which easily exceed the
// integration-suite default `it` timeout of 100ms.
describe('Journey: Mongo migration authoring (offline)', { timeout: timeouts.spinUpPpgDev }, () => {
  const created = new Set<string>();

  afterEach(async () => {
    for (const dir of created) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    created.clear();
  });

  it('migration plan --target mongo scaffolds migration.ts, populates the contract snapshot store, and emits attested ops.json', async () => {
    const ctx = setupMongoJourney(undefined);
    created.add(ctx.testDir);

    const emit0 = await runContractEmit(ctx);
    expect(emit0.exitCode, `contract emit: ${emit0.stderr}`).toBe(0);

    const plan = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(plan.exitCode, `migration plan: ${plan.stdout}\n${plan.stderr}`).toBe(0);

    const migrationDir = getLatestMigrationDir(ctx);

    const migrationTs = readFileSync(join(migrationDir, 'migration.ts'), 'utf-8');
    expect(migrationTs).toContain('@prisma/orm-mongo/target/migration');
    expect(migrationTs).toContain('createIndex');
    // Prettier rewrites double-quoted literals to single-quoted on disk.
    expect(migrationTs).toContain("'users'");
    expect(migrationTs).toContain('MigrationCLI.run(import.meta.url');

    const draftManifest = JSON.parse(
      readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
    ) as { to: string };

    // The store canonicalizes JSON (compact, sorted keys), while the
    // emitted project artifact is pretty-printed — compare parsed content,
    // not bytes.
    expect(
      JSON.parse(
        readFileSync(contractSnapshotPath(ctx, draftManifest.to, 'contract.json'), 'utf-8'),
      ),
    ).toEqual(JSON.parse(readFileSync(join(ctx.outputDir, 'contract.json'), 'utf-8')));
    expect(
      readFileSync(contractSnapshotPath(ctx, draftManifest.to, 'contract.d.ts'), 'utf-8'),
    ).toBe(readFileSync(join(ctx.outputDir, 'contract.d.ts'), 'utf-8'));

    // Plan leaves a draft migration; self-emit by running migration.ts in-process to
    // produce `ops.json` and the attested `migration.json`.
    const emit = await selfEmitMigration(ctx, [
      '--dir',
      `migrations/app/${basename(migrationDir)}`,
    ]);
    expect(emit.exitCode, `migration.ts self-emit: ${emit.stdout}\n${emit.stderr}`).toBe(0);

    const ops = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8')) as ReadonlyArray<{
      id: string;
      operationClass: string;
      kind?: string;
    }>;
    const opIds = ops.map((o) => o.id).sort();
    expect(opIds.some((id) => id.startsWith('index.users.'))).toBe(true);
    for (const op of ops) {
      expect(op.operationClass).toBe('additive');
    }

    const manifest = JSON.parse(readFileSync(join(migrationDir, 'migration.json'), 'utf-8')) as {
      migrationHash: string;
    };
    expect(manifest.migrationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('migration new --target mongo scaffolds an empty Migration stub with the contract snapshot store populated', async () => {
    const ctx = setupMongoJourney(undefined);
    created.add(ctx.testDir);

    const emit0 = await runContractEmit(ctx);
    expect(emit0.exitCode, `contract emit base: ${emit0.stderr}`).toBe(0);

    const plan = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(plan.exitCode, `seed initial migration: ${plan.stderr}`).toBe(0);

    swapToAdditive(ctx);
    const emit1 = await runContractEmit(ctx);
    expect(emit1.exitCode, `contract emit additive: ${emit1.stderr}`).toBe(0);

    const newResult = await runMigrationNew(ctx, [
      '--name',
      'add-name-index',
      '--from',
      latestMigrationToHash(ctx),
    ]);
    expect(newResult.exitCode, `migration new: ${newResult.stdout}\n${newResult.stderr}`).toBe(0);

    const migrationDir = findMigrationDirBySlug(ctx, 'add_name_index');

    const migrationTs = readFileSync(join(migrationDir, 'migration.ts'), 'utf-8');
    expect(migrationTs).toContain(
      "import { Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration'",
    );
    // New generator shape: the base derives describe() from the imported contract
    // JSON, so the scaffold carries `Migration<…, End>` + the endContractJson
    // field and emits no describe() / hash literals.
    expect(migrationTs).toContain('class M extends Migration<');
    expect(migrationTs).not.toContain('describe()');
    expect(migrationTs).toContain('override readonly endContractJson = endContract;');
    expect(migrationTs).toContain('get operations()');
    expect(migrationTs).toContain('return [');
    // Empty stub: no operation factory is imported because no calls were rendered.
    expect(migrationTs).not.toContain('createIndex');

    const manifest = JSON.parse(readFileSync(join(migrationDir, 'migration.json'), 'utf-8')) as {
      to: string;
      migrationHash: string;
    };

    // The store canonicalizes JSON (compact, sorted keys), while the
    // emitted project artifact is pretty-printed — compare parsed content,
    // not bytes.
    expect(
      JSON.parse(readFileSync(contractSnapshotPath(ctx, manifest.to, 'contract.json'), 'utf-8')),
    ).toEqual(JSON.parse(readFileSync(join(ctx.outputDir, 'contract.json'), 'utf-8')));
    expect(readFileSync(contractSnapshotPath(ctx, manifest.to, 'contract.d.ts'), 'utf-8')).toBe(
      readFileSync(join(ctx.outputDir, 'contract.d.ts'), 'utf-8'),
    );

    const ops = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
    // `migration new` always writes a fully attested package; the
    // `migrationHash` is the content-address over `(manifest, [])` since
    // the scaffolded `migration.ts` carries no operations yet. The
    // developer fills in operations and re-runs `node migration.ts` to
    // rewrite both `ops.json` and `migrationHash`.
    expect(manifest.migrationHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Journey: Mongo migration authoring (live database)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const dbName = 'mongo_journey_test';
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

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

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

  it('plans + applies initial DDL, then hand-authored dataTransform migration runs against live MongoDB', async () => {
    const connectionString = buildMongoUri(replSet.getUri(), dbName);
    const ctx = setupMongoJourney(connectionString);
    created.add(ctx.testDir);

    const emit0 = await runContractEmit(ctx);
    expect(emit0.exitCode, `contract emit: ${emit0.stderr}`).toBe(0);

    const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(plan0.exitCode, `migration plan initial: ${plan0.stdout}\n${plan0.stderr}`).toBe(0);

    const emitInit = await selfEmitMigration(ctx, [
      '--dir',
      `migrations/app/${basename(getLatestMigrationDir(ctx))}`,
    ]);
    expect(
      emitInit.exitCode,
      `migration.ts self-emit initial: ${emitInit.stdout}\n${emitInit.stderr}`,
    ).toBe(0);

    const apply0 = await runMigrate(ctx);
    expect(apply0.exitCode, `migrate initial: ${apply0.stdout}\n${apply0.stderr}`).toBe(0);

    const collections = await client.db(dbName).listCollections({ name: 'users' }).toArray();
    expect(collections.map((c) => c.name)).toContain('users');

    await client
      .db(dbName)
      .collection('users')
      .insertMany([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'BOB' },
        { email: 'carol@example.com', name: 'Carol' },
      ]);

    swapToAdditive(ctx);
    const emit1 = await runContractEmit(ctx);
    expect(emit1.exitCode, `contract emit additive: ${emit1.stderr}`).toBe(0);

    const newResult = await runMigrationNew(ctx, [
      '--name',
      'normalize-names',
      '--from',
      latestMigrationToHash(ctx),
    ]);
    expect(newResult.exitCode, `migration new: ${newResult.stdout}\n${newResult.stderr}`).toBe(0);

    const migrationDir = findMigrationDirBySlug(ctx, 'normalize_names');
    const migrationTsPath = join(migrationDir, 'migration.ts');
    const draftManifest = JSON.parse(
      readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
    ) as { from: string; to: string };

    // Hand-author the migration: a createIndex op (matches what the planner
    // would emit) plus a dataTransform that lowercases the `name` field.
    // The check finds documents whose `name` contains an uppercase letter;
    // after the transform all names are lower-case so the check is
    // satisfied, enabling idempotency-skip on re-apply (tested below).
    const handAuthored = `import { createIndex, dataTransform, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import { RawUpdateManyCommand, RawAggregateCommand } from '@prisma/orm-mongo/query-ast/execution';

const planMeta = {
  target: 'mongo',
  storageHash: 'hand-authored',
  lane: 'mongo-raw',
  paramDescriptors: [],
};

class M extends Migration {
  override describe() {
    return {
      from: ${JSON.stringify(draftManifest.from)},
      to: ${JSON.stringify(draftManifest.to)},
    };
  }

  override get operations() {
    return [
      createIndex('users', [{ field: 'name', direction: 1 }]),
      dataTransform('lowercase-user-name', {
        invariantId: ${JSON.stringify(INVARIANT_ID)},
        check: {
          source: () => ({
            collection: 'users',
            command: new RawAggregateCommand(
              'users',
              [{ $match: { name: { $regex: '[A-Z]' } } }, { $limit: 1 }],
            ),
            meta: { ...planMeta, lane: 'mongo-pipeline' },
          }),
        },
        run: () => ({
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            { name: { $exists: true } },
            [{ $set: { name: { $toLower: '$name' } } }],
          ),
          meta: planMeta,
        }),
      }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
`;
    writeFileSync(migrationTsPath, handAuthored);

    const emitResult = await selfEmitMigration(ctx, ['--dir', migrationDir]);
    expect(
      emitResult.exitCode,
      `migration.ts self-emit: ${emitResult.stdout}\n${emitResult.stderr}`,
    ).toBe(0);

    const ops = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8')) as ReadonlyArray<{
      id: string;
      operationClass: string;
    }>;
    expect(ops.map((o) => o.id)).toEqual(
      expect.arrayContaining(['data_transform.lowercase-user-name']),
    );
    expect(ops.some((o) => o.id.startsWith('index.users.'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(migrationDir, 'migration.json'), 'utf-8')) as {
      migrationHash: string;
    };
    expect(manifest.migrationHash).toMatch(/^[a-f0-9]{64}$/);

    // The transform declares an invariantId and the ref requires it — apply
    // routes on the invariant and the Mongo runner accumulates it onto the
    // marker doc via its aggregation-pipeline $setUnion merge (moved from
    // the deleted invariant-routing.mongo mirror).
    writeRefFile(ctx, 'prod', draftManifest.to, [INVARIANT_ID]);
    const apply1 = await runMigrate(ctx, ['--to', 'prod', '--json']);
    expect(apply1.exitCode, `migrate additive: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);
    const apply1Result = parseJsonOutput<{
      ok: boolean;
      markerHash: string;
      pathDecision?: {
        requiredInvariants: readonly string[];
        satisfiedInvariants: readonly string[];
      };
    }>(apply1);
    expect(apply1Result.ok, 'apply ok').toBe(true);
    expect(apply1Result.pathDecision?.requiredInvariants, 'required reflects the ref').toEqual([
      INVARIANT_ID,
    ]);
    expect(
      apply1Result.pathDecision?.satisfiedInvariants,
      'the selected path satisfies the invariant',
    ).toEqual([INVARIANT_ID]);

    const users = await client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0, email: 1, name: 1 } })
      .sort({ email: 1 })
      .toArray();
    expect(users).toEqual([
      { email: 'alice@example.com', name: 'alice' },
      { email: 'bob@example.com', name: 'bob' },
      { email: 'carol@example.com', name: 'carol' },
    ]);

    const indexes = await client.db(dbName).collection('users').indexes();
    expect(indexes.some((idx) => JSON.stringify(idx.key) === JSON.stringify({ name: 1 }))).toBe(
      true,
    );

    // Status reads the marker document back and proves the invariant
    // accumulated onto it via the Mongo runner's server-side $setUnion
    // merge: nothing missing, path applied, up to date.
    const statusRef = await runMigrationStatus(ctx, ['--to', 'prod', '--json']);
    expect(statusRef.exitCode, `status --to prod: ${statusRef.stdout}\n${statusRef.stderr}`).toBe(
      0,
    );
    const statusResult = parseMigrationStatusJson(statusRef);
    expect(
      statusResult.diagnostics?.some((d) => d.code === 'MIGRATION.MISSING_INVARIANTS'),
      'no missing-invariants diagnostic',
    ).toBeFalsy();
    expect(statusResult.summary, 'status up to date').toMatch(/up to date/i);
    expect(
      migrationStatusAppSpace(statusResult).migrations.every((m) => m.status === 'applied'),
      'path migrations applied',
    ).toBe(true);

    // Re-apply is a true no-op: the CLI's marker subtraction empties the
    // required set and the runner short-circuits via its
    // incomingIsSubsetOfExisting guard — marker unchanged, and the
    // postcheck sees all names already lower-case so data is byte-identical.
    const apply2 = await runMigrate(ctx, ['--to', 'prod', '--json']);
    expect(apply2.exitCode, `re-apply: ${apply2.stdout}\n${apply2.stderr}`).toBe(0);
    const apply2Result = parseJsonOutput<{ ok: boolean; markerHash: string; summary: string }>(
      apply2,
    );
    expect(apply2Result.ok, 're-apply ok').toBe(true);
    expect(apply2Result.markerHash, 'marker unchanged').toBe(apply1Result.markerHash);
    expect(apply2Result.summary, 'noop summary').toMatch(/up to date/i);

    const usersAfterReApply = await client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0, email: 1, name: 1 } })
      .sort({ email: 1 })
      .toArray();
    expect(usersAfterReApply).toEqual(users);
  });
});
