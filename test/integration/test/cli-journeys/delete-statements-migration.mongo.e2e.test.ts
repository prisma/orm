/**
 * Statements that consent to data loss (MongoDB).
 *
 * Dropping a collection loses its documents, so `migration plan` and `db update` ask what the drop means; `--delete <Model>` answers. The MongoDB planner refuses rename statements in this release.
 *
 * Journey S1 removes `Event` through `migration plan`: refused without `--delete Event`, planned with it, and applied by `migrate`. Journey S2 does the same through `db update`, where `--confirm <database>` no longer consents. Journey S3 adds a required field with no refusal. Journey S4 gives a rename, which renames the collection and keeps its documents. Journey S5 follows, as printed, the refusal of a field rename whose model keeps its name while its collection changes. Journey S6 follows, through `db update`, the question about a collection whose model keeps its name, and keeps its documents.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  followRenameCollectionAdvice,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  runPrintedSelfEmit,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

interface AppliedStatementReport {
  readonly description: string;
}

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeProjectManifest(testDir);
  copyFileSync(join(FIXTURES_DIR, 'contract-with-events.ts'), join(testDir, 'contract.ts'));
  const config = readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir };
}

const USERS_PSL = `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
  email String
  name  String

  @@map("users")
}
`;

const USERS_WITH_NICKNAME_PSL = USERS_PSL.replace(
  '  name  String\n',
  '  name  String\n  nickname String\n',
);

/** A project whose contract is PSL, which emits a validator for each collection. */
function setupPslProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-delete-psl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeProjectManifest(testDir);
  writeFileSync(join(testDir, 'contract.prisma'), USERS_PSL, 'utf-8');
  const configPath = writeMongoPslConfig(testDir, connectionString);
  return { testDir, configPath, outputDir };
}

function useFixture(ctx: JourneyContext, name: string): void {
  copyFileSync(join(FIXTURES_DIR, name), join(ctx.testDir, 'contract.ts'));
}

async function emit(ctx: JourneyContext, label: string): Promise<void> {
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

function nextActionsOf(result: Parameters<typeof engineError>[0]): string {
  return JSON.stringify(engineError(result)?.nextActions ?? []);
}

describe('Journeys (MongoDB): statements that consent to data loss', {
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

  async function collections(dbName: string): Promise<readonly string[]> {
    const listed = await client.db(dbName).listCollections().toArray();
    return listed
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('_prisma'))
      .sort();
  }

  it('S1: migration plan refuses the drop until --delete names the model, then migrates it', async () => {
    const dbName = 'mongo_delete_plan';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S1.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `S1.02: plan initial: ${initial.stderr}`).toBe(0);
    const applyInitial = await runMigrate(ctx);
    expect(applyInitial.exitCode, `S1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    const origin = latestMigrationDirName(ctx);
    useFixture(ctx, 'contract-additive.ts');
    await emit(ctx, 'S1.04');

    const refused = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(refused.exitCode, 'S1.05: the plan drops events, so it is refused').toBe(2);
    expect(engineError(refused)?.code, 'S1.05: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
    expect(nextActionsOf(refused), 'S1.05: names the flag that answers').toContain(
      '--delete Event',
    );

    const plan = await runMigrationPlan(ctx, [
      '--name',
      'drop-events',
      '--from',
      origin,
      '--delete',
      'Event',
      '--json',
    ]);
    expect(plan.exitCode, `S1.06: plan with --delete: ${plan.stderr}`).toBe(0);
    expect(
      parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
        plan,
      ).appliedStatements.map((entry) => entry.description),
      'S1.06: the delete is applied',
    ).toEqual(['delete model "Event"']);

    const apply = await runMigrate(ctx);
    expect(apply.exitCode, `S1.07: migrate: ${apply.stderr}`).toBe(0);
    expect(await collections(dbName), 'S1.07: the collection is gone').toEqual(['users']);
  });

  it('S2: db update refuses --confirm and drops the collection with --delete', async () => {
    const dbName = 'mongo_delete_update';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S2.01');
    const create = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(create.exitCode, `S2.02: db update creates the collections: ${create.stderr}`).toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    useFixture(ctx, 'contract-additive.ts');
    await emit(ctx, 'S2.03');

    const confirmed = await runDbUpdate(ctx, ['--no-interactive', '--confirm', dbName, '--json']);
    expect(confirmed.exitCode, 'S2.04: --confirm does not consent').toBe(2);
    expect(engineError(confirmed)?.code, 'S2.04: the question is unanswered').toBe(
      'CLI.CONSENT_REQUIRED',
    );
    expect(nextActionsOf(confirmed), 'S2.04: names the flag that answers').toContain(
      '--delete Event',
    );
    expect(await collections(dbName), 'S2.04: nothing dropped').toContain('events');

    const deleted = await runDbUpdate(ctx, ['--no-interactive', '--delete', 'Event', '--json']);
    expect(deleted.exitCode, `S2.05: db update --delete Event: ${deleted.stderr}`).toBe(0);
    expect(
      parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
        deleted,
      ).appliedStatements.map((entry) => entry.description),
      'S2.05: the delete is applied',
    ).toEqual(['delete model "Event"']);
    expect(await collections(dbName), 'S2.05: the collection is gone').toEqual(['users']);
  });

  it('S3: db update adds a required field to a collection with documents without asking', async () => {
    const dbName = 'mongo_delete_required';
    const ctx = setupPslProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S3.01');
    const create = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(create.exitCode, `S3.02: db update creates users: ${create.stderr}`).toBe(0);
    await client.db(dbName).collection('users').insertOne({ email: 'a@example.com', name: 'a' });
    writeFileSync(join(ctx.testDir, 'contract.prisma'), USERS_WITH_NICKNAME_PSL, 'utf-8');
    await emit(ctx, 'S3.03');

    const update = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(update.exitCode, `S3.04: db update adds the field: ${update.stdout}`).toBe(0);
    const [users] = await client
      .db(dbName)
      .listCollections({ name: 'users' }, { nameOnly: false })
      .toArray();
    expect(users, 'S3.05: the validator requires the new field').toMatchObject({
      options: {
        validator: { $jsonSchema: { required: expect.arrayContaining(['nickname']) } },
      },
    });
    const documents = await client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    expect(documents, 'S3.05: the existing document is kept').toEqual([
      { email: 'a@example.com', name: 'a' },
    ]);
  });

  it('S4: a rename statement renames the collection and keeps its documents', async () => {
    const dbName = 'mongo_delete_rename';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S4.01');
    const create = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(create.exitCode, `S4.02: db update creates the collections: ${create.stderr}`).toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    useFixture(ctx, 'contract-events-renamed.ts');
    await emit(ctx, 'S4.03');

    const renamed = await runDbUpdate(ctx, [
      '--no-interactive',
      '--rename',
      'Event:Occasion',
      '--json',
    ]);
    expect(renamed.exitCode, `S4.04: the rename runs: ${renamed.stderr}`).toBe(0);
    expect(await collections(dbName), 'S4.04: the collection is renamed').toEqual([
      'occasions',
      'users',
    ]);
    const documents = await client
      .db(dbName)
      .collection('occasions')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    expect(documents, 'S4.04: its documents are kept').toEqual([{ name: 'launch' }]);
  });

  it('S5: the advice for a field rename whose collection changes keeps the documents when followed as printed', async () => {
    const dbName = 'mongo_remap_then_rename';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S5.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `S5.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'S5.03: migrate initial').toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    const origin = latestMigrationDirName(ctx);

    useFixture(ctx, 'contract-events-remapped-title.ts');
    await emit(ctx, 'S5.04');
    const refused = await runMigrationPlan(ctx, [
      '--from',
      origin,
      '--rename',
      'Event.name:Event.title',
      '--json',
    ]);
    expect(refused.exitCode, 'S5.05: the field rename is refused').not.toBe(0);
    expect(JSON.stringify(engineError(refused)?.meta), 'S5.05: the advice').toContain(
      'run node on that migration.ts so it writes ops.json again',
    );

    useFixture(ctx, 'contract-events-remapped.ts');
    await emit(ctx, 'S5.06');
    const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(asked.exitCode, 'S5.06: the drop of events needs a statement').toBe(2);
    expect(
      JSON.stringify(engineError(asked)),
      'S5.06: the question says how to keep the documents',
    ).toContain(
      'make renameCollection(\\"events\\", \\"occasions\\") the first operation, imported with the other operations, delete the drop of \\"events\\", and delete the create of \\"occasions\\" if there is one',
    );
    const remap = await runMigrationPlan(ctx, [
      '--name',
      'remap',
      '--from',
      origin,
      '--delete',
      'Event',
    ]);
    expect(
      remap.exitCode,
      `S5.07: plan the collection change with --delete Event: ${remap.stderr}`,
    ).toBe(0);
    const remapDir = latestMigrationDirName(ctx);
    const migrationTs = join(ctx.testDir, 'migrations/app', remapDir, 'migration.ts');
    const planned = readFileSync(migrationTs, 'utf-8');
    const edited = followRenameCollectionAdvice(planned, 'events', 'occasions');
    expect(edited, `S5.08: migration.ts is edited as the advice says:\n${edited}`).toMatch(
      /return \[renameCollection\("events", "occasions"\)/,
    );
    expect(edited, `S5.08: the drop and the create are gone:\n${edited}`).not.toMatch(
      /dropCollection\(['"]events|createCollection\(['"]occasions/,
    );
    writeFileSync(migrationTs, edited, 'utf-8');
    const emitted = runPrintedSelfEmit(String(engineError(asked)?.why), dirname(migrationTs));
    expect(emitted.exitCode, `S5.09: node on migration.ts, as printed: ${emitted.stderr}`).toBe(0);
    const applyRemap = await runMigrate(ctx);
    expect(applyRemap.exitCode, `S5.10: migrate: ${applyRemap.stderr}`).toBe(0);

    useFixture(ctx, 'contract-events-remapped-title.ts');
    await emit(ctx, 'S5.11');
    const rename = await runMigrationPlan(ctx, [
      '--name',
      'title',
      '--from',
      remapDir,
      '--rename',
      'Event.name:Event.title',
    ]);
    expect(rename.exitCode, `S5.12: plan the field rename: ${rename.stderr}`).toBe(0);
    const applyRename = await runMigrate(ctx);
    expect(applyRename.exitCode, `S5.13: migrate: ${applyRename.stderr}`).toBe(0);

    expect(await collections(dbName), 'S5.14: the collection is renamed').toEqual([
      'occasions',
      'users',
    ]);
    const documents = await client
      .db(dbName)
      .collection('occasions')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    expect(documents, 'S5.14: its document is kept under the new field').toEqual([
      { title: 'launch' },
    ]);
  });

  it('S6: db update keeps the documents when the question about a collection whose model keeps its name is followed', async () => {
    const dbName = 'mongo_remap_update';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S6.01');
    const create = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(create.exitCode, `S6.02: db update creates the collections: ${create.stderr}`).toBe(0);
    await client.db(dbName).collection('events').insertOne({ name: 'launch' });
    useFixture(ctx, 'contract-events-remapped.ts');
    await emit(ctx, 'S6.03');

    const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(refused.exitCode, 'S6.04: the drop of events needs a statement').toBe(2);
    expect(engineError(refused)?.code, 'S6.04').toBe('CLI.CONSENT_REQUIRED');
    expect(
      JSON.stringify(engineError(refused)),
      'S6.04: the question says how to keep the documents',
    ).toContain(
      'db.getCollection(\\"events\\").renameCollection(\\"occasions\\") in mongosh, then run db update',
    );
    expect(await collections(dbName), 'S6.04: nothing dropped').toContain('events');

    await client.db(dbName).collection('events').rename('occasions');
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(updated.exitCode, `S6.05: db update after the rename: ${updated.stderr}`).toBe(0);
    expect(await collections(dbName), 'S6.05: the collection is renamed').toEqual([
      'occasions',
      'users',
    ]);
    const documents = await client
      .db(dbName)
      .collection('occasions')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    expect(documents, 'S6.05: its document is kept').toEqual([{ name: 'launch' }]);
  });
});
