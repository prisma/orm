/**
 * Renames and removals of fields inside value objects and embedded models on MongoDB collections that hold documents, through `migration plan` then `db migrate`, and through `db update`.
 *
 * O1 renames `Address.street` to `line1` where `User.addresses` holds a list of `Address`. O2 removes `Address.zip` where `Address` sits inside `Company.hq`, with `--delete`. O3 renames `Line.sku` to `code` in a one-to-many embed of a TypeScript contract. O4 removes a value object field without `--delete`: the plan stops and asks, naming `--delete Address.zip`, and the same command with that answer applies. O5 stops part way through a migration on an element that holds both the old and the new key, and a re-run after the fix finishes it. Every journey that applies ends with an empty further plan, a clean `db verify --schema-only`, and every document accepting an update.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Document, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  expectMigrationTsReproducesOps,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

/** A PSL contract whose `User` documents hold `fields`, with `types` declared above. */
function usersPsl(types: string, fields: string): string {
  return `// use prisma-8
${types}
model User {
  id    ObjectId @id @map("_id")
  email String
${fields}

  @@map("users")
}
`;
}

/** A contract: PSL source, or the name of a TypeScript contract fixture. */
type Source = { readonly psl: string } | { readonly typescriptFixture: string };

interface Journey {
  readonly before: Source;
  readonly after: Source;
  readonly documents: readonly Document[];
  readonly statements: readonly string[];
}

describe('Journeys (MongoDB): renames and removals inside value objects and embedded models', {
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

  function setup(dbName: string, source: Source): JourneyContext {
    const url = new URL(replSet.getUri());
    url.pathname = `/${dbName}`;
    const testDir = join(
      fixtureAppDir,
      `test-mongo-value-object-statements-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const outputDir = join(testDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    created.add(testDir);
    if ('psl' in source) {
      writeProjectManifest(testDir);
      return { testDir, configPath: writeMongoPslConfig(testDir, url.toString()), outputDir };
    }
    mkdirSync(join(testDir, 'migrations'), { recursive: true });
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'mongo-value-object-statements-journey',
        private: true,
        type: 'module',
        dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
      }),
      'utf-8',
    );
    copyFileSync(join(FIXTURES_DIR, 'contract-with-events.ts'), join(testDir, 'contract.ts'));
    const configPath = join(testDir, 'prisma.config.ts');
    writeFileSync(
      configPath,
      readFileSync(join(FIXTURES_DIR, 'prisma.config.with-db.ts'), 'utf-8').replace(
        /\{\{DB_URL\}\}/g,
        () => url.toString(),
      ),
      'utf-8',
    );
    return { testDir, configPath, outputDir };
  }

  async function emit(ctx: JourneyContext, source: Source, label: string): Promise<void> {
    if ('psl' in source) {
      writeFileSync(join(ctx.testDir, 'contract.prisma'), source.psl, 'utf-8');
    } else {
      copyFileSync(join(FIXTURES_DIR, source.typescriptFixture), join(ctx.testDir, 'contract.ts'));
    }
    const emitted = await runContractEmit(ctx);
    expect(emitted.exitCode, `${label}: emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
  }

  async function documents(dbName: string): Promise<Document[]> {
    return client
      .db(dbName)
      .collection('users')
      .find({}, { projection: { _id: 0 }, sort: { email: 1 } })
      .toArray();
  }

  async function seed(dbName: string, rows: readonly Document[]): Promise<void> {
    await client
      .db(dbName)
      .collection('users')
      .insertMany(
        rows.map((row) => ({ ...row })),
        { bypassDocumentValidation: true },
      );
  }

  /** The database matches the contract, a further plan is empty, and every document accepts an update that does not skip document validation. */
  async function verifiedAndSettled(
    ctx: JourneyContext,
    dbName: string,
    label: string,
    further: () => Promise<readonly unknown[]>,
  ) {
    const verify = await runDbVerify(ctx, ['--schema-only']);
    expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
    expect(await further(), `${label}: a further plan is empty`).toEqual([]);
    const users = client.db(dbName).collection('users');
    const count = await users.countDocuments();
    const updated = await users.updateMany({}, [
      { $set: { email: { $concat: ['$email', '.updated'] } } },
    ]);
    expect(updated.modifiedCount, `${label}: every document accepts an update`).toBe(count);
  }

  /** Creates the collection with the journey's first contract through `migration plan` and `db migrate`, seeds it, and emits the second. Returns the origin migration. */
  async function migratedThenChanged(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName, journey.before);
    await emit(ctx, journey.before, `${label}.01`);
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: ${initial.stdout}\n${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.03`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    await seed(dbName, journey.documents);
    await emit(ctx, journey.after, `${label}.04`);
    return { ctx, origin };
  }

  /** Plans the change with `migration plan`, re-runs its `migration.ts`, applies it with `db migrate`, and returns the documents and the `migration.ts`. */
  async function throughMigrationPlan(dbName: string, journey: Journey, label: string) {
    const { ctx, origin } = await migratedThenChanged(dbName, journey, label);
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'change',
      '--from',
      origin,
      ...journey.statements,
      '--json',
    ]);
    expect(
      planned.exitCode,
      `${label}.05: migration plan: ${planned.stdout}\n${planned.stderr}`,
    ).toBe(0);
    const migrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    await expectMigrationTsReproducesOps(ctx, migrationDir, `${label}.06`);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `${label}.07: db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(
      0,
    );
    const changed = latestMigrationDirName(ctx);
    const after = await documents(dbName);
    await verifiedAndSettled(ctx, dbName, label, async () => {
      const further = await runMigrationPlan(ctx, ['--from', changed, '--json']);
      return parseJsonOutput<{ operations: readonly unknown[] }>(further).operations;
    });
    return {
      documents: after,
      migrationTs: readFileSync(join(migrationDir, 'migration.ts'), 'utf-8'),
    };
  }

  /** Applies the change with `db update` and returns the documents. */
  async function throughDbUpdate(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName, journey.before);
    await emit(ctx, journey.before, `${label}.11`);
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, `${label}.12`).toBe(0);
    await seed(dbName, journey.documents);
    await emit(ctx, journey.after, `${label}.13`);
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json', ...journey.statements]);
    expect(updated.exitCode, `${label}.14: db update: ${updated.stdout}\n${updated.stderr}`).toBe(
      0,
    );
    const after = await documents(dbName);
    await verifiedAndSettled(ctx, dbName, label, async () => {
      const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });
    return after;
  }

  /** The stored key calls of a `migration.ts`, without white space. */
  function storedKeyCalls(migrationTs: string): readonly string[] {
    return (
      migrationTs
        .replace(/\s+/g, '')
        .replace(/,\}/g, '}')
        .match(/(?:rename|remove)StoredKey\(\{[^)]*\}\)/g) ?? []
    );
  }

  const ADDRESS = (members: string) => `type Address {\n${members}\n}\n`;

  it('O1: --rename renames a key in a list of value objects, with both commands', async () => {
    const journey: Journey = {
      before: { psl: usersPsl(ADDRESS('  street String'), '  addresses Address[]') },
      after: { psl: usersPsl(ADDRESS('  line1 String'), '  addresses Address[]') },
      documents: [
        { email: 'a@example.com', addresses: [{ street: 'Main St' }, { street: 'High St' }] },
        { email: 'b@example.com', addresses: [] },
      ],
      statements: ['--rename', 'Address.street:Address.line1'],
    };
    const renamed = [
      { email: 'a@example.com', addresses: [{ line1: 'Main St' }, { line1: 'High St' }] },
      { email: 'b@example.com', addresses: [] },
    ];

    const planned = await throughMigrationPlan('mongo_o1_plan', journey, 'O1');
    expect({
      documents: planned.documents,
      calls: storedKeyCalls(planned.migrationTs),
    }).toEqual({
      documents: renamed,
      calls: [
        "renameStoredKey({collection:'users',field:'addresses',path:'$[*].street',to:'line1'})",
      ],
    });
    expect(await throughDbUpdate('mongo_o1_update', journey, 'O1')).toEqual(renamed);
  });

  it('O2: --delete removes a key from a nested value object, leaving null and missing ones', async () => {
    const types = (address: string) =>
      `${ADDRESS(address)}\ntype Company {\n  name String\n  hq   Address?\n}\n`;
    const journey: Journey = {
      before: { psl: usersPsl(types('  street String\n  zip    String'), '  company Company?') },
      after: { psl: usersPsl(types('  street String'), '  company Company?') },
      documents: [
        {
          email: 'a@example.com',
          company: { name: 'Acme', hq: { street: 'Main St', zip: '12345' } },
        },
        { email: 'b@example.com', company: { name: 'Solo', hq: null } },
        { email: 'c@example.com', company: null },
        { email: 'd@example.com' },
      ],
      statements: ['--delete', 'Address.zip'],
    };
    const removed = [
      { email: 'a@example.com', company: { name: 'Acme', hq: { street: 'Main St' } } },
      { email: 'b@example.com', company: { name: 'Solo', hq: null } },
      { email: 'c@example.com', company: null },
      { email: 'd@example.com' },
    ];

    const planned = await throughMigrationPlan('mongo_o2_plan', journey, 'O2');
    expect({
      documents: planned.documents,
      calls: storedKeyCalls(planned.migrationTs),
    }).toEqual({
      documents: removed,
      calls: ["removeStoredKey({collection:'users',field:'company',path:'$.hq.zip'})"],
    });
    expect(await throughDbUpdate('mongo_o2_update', journey, 'O2')).toEqual(removed);
  });

  it('O3: --rename renames a key of an embedded model in a one-to-many embed, with both commands', async () => {
    const journey: Journey = {
      before: { typescriptFixture: 'contract-lines-sku.ts' },
      after: { typescriptFixture: 'contract-lines-code.ts' },
      documents: [
        { email: 'a@example.com', lines: [{ sku: 'A-1' }, { sku: 'B-2' }] },
        { email: 'b@example.com', lines: [] },
        { email: 'c@example.com' },
      ],
      statements: ['--rename', 'Line.sku:Line.code'],
    };
    const renamed = [
      { email: 'a@example.com', lines: [{ code: 'A-1' }, { code: 'B-2' }] },
      { email: 'b@example.com', lines: [] },
      { email: 'c@example.com' },
    ];

    const planned = await throughMigrationPlan('mongo_o3_plan', journey, 'O3');
    expect({
      documents: planned.documents,
      calls: storedKeyCalls(planned.migrationTs),
    }).toEqual({
      documents: renamed,
      calls: ["renameStoredKey({collection:'users',field:'lines',path:'$[*].sku',to:'code'})"],
    });
    expect(await throughDbUpdate('mongo_o3_update', journey, 'O3')).toEqual(renamed);
  });

  it('O4: a removed value object field is asked about, and --delete answers it', async () => {
    const journey: Journey = {
      before: { psl: usersPsl(ADDRESS('  street String\n  zip    String'), '  home Address?') },
      after: { psl: usersPsl(ADDRESS('  street String'), '  home Address?') },
      documents: [{ email: 'a@example.com', home: { street: 'Main St', zip: '12345' } }],
      statements: ['--delete', 'Address.zip'],
    };
    const { ctx, origin } = await migratedThenChanged('mongo_o4_plan', journey, 'O4');
    const asked = await runMigrationPlan(ctx, ['--name', 'change', '--from', origin, '--json']);
    const question = engineError(asked);

    expect({
      exitCode: asked.exitCode === 0 ? 0 : 'failed',
      code: question?.code,
      summary: question?.summary,
      why: question?.why,
      answers: question?.nextActions?.map(({ label }) => label),
    }).toEqual({
      exitCode: 'failed',
      code: 'CLI.CONSENT_REQUIRED',
      summary: 'Removing value object field "Address.zip" would delete its values.',
      why: 'The operation of the plan that does this: Remove key "zip" at path "$" in field home of collection users.',
      answers: [
        "If the value object field was renamed, add it to the contract under its new name and run `prisma-test contract emit`; then keep its values: --rename 'Address.zip:Address.<new name>'",
        'If the values can go: --delete Address.zip',
      ],
    });

    const answered = await runMigrationPlan(ctx, [
      '--name',
      'change',
      '--from',
      origin,
      ...journey.statements,
      '--json',
    ]);
    expect(answered.exitCode, `O4.06: ${answered.stdout}\n${answered.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'O4.07').toBe(0);
    expect(await documents('mongo_o4_plan')).toEqual([
      { email: 'a@example.com', home: { street: 'Main St' } },
    ]);
    expect(await throughDbUpdate('mongo_o4_update', journey, 'O4')).toEqual([
      { email: 'a@example.com', home: { street: 'Main St' } },
    ]);
  });

  it('O5: a migration that stops part way finishes on a re-run once the documents are fixed', async () => {
    const journey: Journey = {
      before: {
        psl: usersPsl(ADDRESS('  street String'), '  home      Address?\n  addresses Address[]'),
      },
      after: {
        psl: usersPsl(ADDRESS('  line1 String'), '  home      Address?\n  addresses Address[]'),
      },
      documents: [
        {
          email: 'a@example.com',
          home: { street: 'Main St' },
          addresses: [{ street: 'High St', line1: 'High St 2' }],
        },
      ],
      statements: ['--rename', 'Address.street:Address.line1'],
    };
    const dbName = 'mongo_o5_plan';
    const { ctx, origin } = await migratedThenChanged(dbName, journey, 'O5');
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'change',
      '--from',
      origin,
      ...journey.statements,
      '--json',
    ]);
    expect(planned.exitCode, `O5.05: ${planned.stdout}\n${planned.stderr}`).toBe(0);

    const stopped = await runMigrate(ctx, ['--json']);
    expect({
      exitCode: stopped.exitCode === 0 ? 0 : 'failed',
      documents: await documents(dbName),
    }).toEqual({
      exitCode: 'failed',
      documents: [
        {
          email: 'a@example.com',
          home: { line1: 'Main St' },
          addresses: [{ street: 'High St', line1: 'High St 2' }],
        },
      ],
    });

    await client
      .db(dbName)
      .collection('users')
      .updateMany({}, [{ $set: { addresses: [{ street: 'High St' }] } }], {
        bypassDocumentValidation: true,
      });
    const rerun = await runMigrate(ctx);
    expect(rerun.exitCode, `O5.08: re-run: ${rerun.stdout}\n${rerun.stderr}`).toBe(0);
    const changed = latestMigrationDirName(ctx);
    expect(await documents(dbName)).toEqual([
      { email: 'a@example.com', home: { line1: 'Main St' }, addresses: [{ line1: 'High St' }] },
    ]);
    await verifiedAndSettled(ctx, dbName, 'O5', async () => {
      const further = await runMigrationPlan(ctx, ['--from', changed, '--json']);
      return parseJsonOutput<{ operations: readonly unknown[] }>(further).operations;
    });
  });
});
