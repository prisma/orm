/**
 * Statements that consent to data loss (MongoDB).
 *
 * Dropping a collection loses its documents, so `migration plan` and `db update` ask what the drop means; `--delete <Model>` answers. The MongoDB planner refuses rename statements in this release.
 *
 * Journey S1 removes `Event` through `migration plan`: refused without `--delete Event`, planned with it, and applied by `migrate`. Journey S2 does the same through `db update`, where `--confirm <database>` no longer consents. Journey S3 adds a required field with no refusal. Journey S4 gives a rename, which the planner refuses with `statementRefused`.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';

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
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'mongo-delete-journey',
      private: true,
      type: 'module',
      dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
    }),
    'utf-8',
  );
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
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'mongo-delete-psl-journey',
      private: true,
      type: 'module',
      dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
    }),
    'utf-8',
  );
  writeFileSync(join(testDir, 'contract.prisma'), USERS_PSL, 'utf-8');
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    [
      "import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';",
      "import { definePrismaConfig } from '@prisma/cli-engine';",
      '',
      'export default definePrismaConfig({',
      '  orm: ormConfig({',
      "    contract: './contract.prisma',",
      "    output: 'output',",
      `    db: { connection: ${JSON.stringify(connectionString)} },`,
      '  }),',
      '});',
      '',
    ].join('\n'),
  );
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

  it('S4: the planner refuses a rename statement', async () => {
    const dbName = 'mongo_delete_rename';
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, 'S4.01');
    const create = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(create.exitCode, `S4.02: db update creates the collections: ${create.stderr}`).toBe(0);
    useFixture(ctx, 'contract-events-renamed.ts');
    await emit(ctx, 'S4.03');

    const renamed = await runDbUpdate(ctx, [
      '--no-interactive',
      '--rename',
      'Event:Occasion',
      '--json',
    ]);
    expect(renamed.exitCode, 'S4.04: the rename is refused').not.toBe(0);
    const refusal = engineError(renamed);
    expect(refusal?.code, 'S4.04: planning failed').toBe('MIGRATION.PLANNING_FAILED');
    expect(JSON.stringify(refusal?.meta), 'S4.04: the conflict is the refused statement').toContain(
      'statementRefused',
    );
    expect(await collections(dbName), 'S4.04: nothing changed').toEqual(['events', 'users']);
  });
});
