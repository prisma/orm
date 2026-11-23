/**
 * Enum value statements on MongoDB collections that hold documents, through `migration plan` then `db migrate`, and through `db update`.
 *
 * `User` has an optional `status`, a list `tags` and an optional value object `home` whose `kind` is a `Status`. `Status.ARCHIVED` stores `archived`.
 *
 * E1 renames it to `RETIRED`, which stores `retired`, with `--rename Status.ARCHIVED:Status.RETIRED`: the scalar, the list and the nested key that held `archived` hold `retired`. E2 swaps the stored values of `ACTIVE` and `ARCHIVED`: the swap is refused, and the route it prints, through values no member stores, swaps them in two migrations. E6 does the same through `db update`. E7 gives `ACTIVE` the stored value of `ARCHIVED`, which the destination removes: refused as a merge, and its route removes `ARCHIVED` first. E3 removes `ARCHIVED` with `--delete Status.ARCHIVED`: the optional field and key lose it and the lists drop it. E4 makes `status` required: while a document holds `archived` there, the apply stops, counts the documents and advises a rename, and once the documents change it succeeds. E5 removes `ARCHIVED` through `db update` with no snapshot of the origin contract: nothing is rewritten, and the validator's document check stops the apply.
 *
 * Every journey that applies ends with an empty further plan, a clean `db verify --schema-only`, and every document accepting an update; each `migration.ts` written is run again and reproduces its `ops.json`.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { planningFailure } from '../utils/stored-name-journeys';

/** A PSL contract whose `Status` has `members`, and whose `User.status` is optional unless `required`. */
function usersPsl(members: string, required = false): string {
  return `// use prisma-8

enum Status {
${members}
}

type Address {
  street String
  kind   Status?
}

model User {
  id     ObjectId @id @map("_id")
  email  String
  status Status${required ? '' : '?'}
  tags   Status[]
  home   Address?

  @@map("users")
}
`;
}

const BEFORE = usersPsl('  ACTIVE = "active"\n  ARCHIVED = "archived"');
const RENAMED = usersPsl('  ACTIVE = "active"\n  RETIRED = "retired"');
const REMOVED = usersPsl('  ACTIVE = "active"');
const SWAPPED = usersPsl('  ACTIVE = "archived"\n  ARCHIVED = "active"');

const THROUGH_SWAP = usersPsl('  ACTIVE = "prisma_swap"\n  ARCHIVED = "prisma_swap_"');

const SWAP_REFUSAL = {
  summary:
    'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.ARCHIVED" move stored values in a cycle, "active" to "archived" and "archived" to "active", and a rewrite of one would overwrite the other before it is read',
  why: 'The plan rewrites a changed stored value in every document that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap"; give "Status.ARCHIVED" a stored value no member stores, such as "prisma_swap_"; and plan and apply that; then give "Status.ACTIVE" the stored value "archived"; give "Status.ARCHIVED" the stored value "active"; and plan again.',
};

const SWAPPED_DOCUMENTS: readonly Document[] = [
  {
    email: 'a@example.com',
    status: 'active',
    tags: ['active', 'archived'],
    home: { street: 'Main St', kind: 'active' },
  },
  { email: 'b@example.com', status: 'archived', tags: [], home: null },
  { email: 'c@example.com', tags: ['archived'] },
];

const DOCUMENTS: readonly Document[] = [
  {
    email: 'a@example.com',
    status: 'archived',
    tags: ['archived', 'active'],
    home: { street: 'Main St', kind: 'archived' },
  },
  { email: 'b@example.com', status: 'active', tags: [], home: null },
  { email: 'c@example.com', tags: ['active'] },
];

interface Journey {
  readonly before: string;
  readonly after: string;
  readonly documents: readonly Document[];
  readonly statements: readonly string[];
}

describe('Journeys (MongoDB): enum value statements', {
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

  function setup(dbName: string): JourneyContext {
    const url = new URL(replSet.getUri());
    url.pathname = `/${dbName}`;
    const testDir = join(
      fixtureAppDir,
      `test-mongo-enum-value-statements-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const outputDir = join(testDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    created.add(testDir);
    writeProjectManifest(testDir);
    return { testDir, configPath: writeMongoPslConfig(testDir, url.toString()), outputDir };
  }

  async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
    writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
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

  function furtherMigrationPlan(ctx: JourneyContext) {
    return async () => {
      const further = await runMigrationPlan(ctx, [
        '--from',
        latestMigrationDirName(ctx),
        '--json',
      ]);
      return parseJsonOutput<{ operations: readonly unknown[] }>(further).operations;
    };
  }

  /** Creates the collection with the first contract through `migration plan` and `db migrate`, seeds it, and emits the second. Returns the origin migration. */
  async function migratedThenChanged(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName);
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
    const after = await documents(dbName);
    await verifiedAndSettled(ctx, dbName, label, furtherMigrationPlan(ctx));
    return {
      documents: after,
      migrationTs: readFileSync(join(migrationDir, 'migration.ts'), 'utf-8'),
    };
  }

  /** Applies the change with `db update` and returns the documents. */
  async function throughDbUpdate(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName);
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

  /** The stored value calls of a `migration.ts`, without white space. */
  function storedValueCalls(migrationTs: string): readonly string[] {
    return (
      migrationTs
        .replace(/\s+/g, '')
        .replace(/,(?=[}\]])/g, '')
        .match(/(?:replace|remove)StoredValue\(\{(?:[^{}]|\{[^{}]*\})*\}\)/g) ?? []
    );
  }

  it('E1: --rename replaces the stored value in a scalar, a list and a value object, with both commands', async () => {
    const journey: Journey = {
      before: BEFORE,
      after: RENAMED,
      documents: DOCUMENTS,
      statements: ['--rename', 'Status.ARCHIVED:Status.RETIRED'],
    };
    const renamed = [
      {
        email: 'a@example.com',
        status: 'retired',
        tags: ['retired', 'active'],
        home: { street: 'Main St', kind: 'retired' },
      },
      { email: 'b@example.com', status: 'active', tags: [], home: null },
      { email: 'c@example.com', tags: ['active'] },
    ];

    const planned = await throughMigrationPlan('mongo_e1_plan', journey, 'E1');
    expect({
      documents: planned.documents,
      calls: storedValueCalls(planned.migrationTs),
    }).toEqual({
      documents: renamed,
      calls: [
        "replaceStoredValue({collection:'users',field:'status',from:'archived',to:{$literal:'retired'}})",
        "replaceStoredValue({collection:'users',field:'tags',from:'archived',to:{$literal:'retired'}})",
        "replaceStoredValue({collection:'users',field:'home',path:'$.kind',from:'archived',to:{$literal:'retired'}})",
      ],
    });
    expect(await throughDbUpdate('mongo_e1_update', journey, 'E1')).toEqual(renamed);
  });

  it('E2: two values that trade places are refused, and the route through values no member stores swaps them with migration plan', async () => {
    const journey: Journey = {
      before: BEFORE,
      after: SWAPPED,
      documents: DOCUMENTS,
      statements: [],
    };
    const dbName = 'mongo_e2_plan';
    const { ctx, origin } = await migratedThenChanged(dbName, journey, 'E2');
    const refused = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(engineError(refused), 'E2.05: the swap is refused').toEqual(
      planningFailure(SWAP_REFUSAL),
    );

    await emit(ctx, THROUGH_SWAP, 'E2.06');
    const away = await runMigrationPlan(ctx, ['--name', 'away', '--from', origin, '--json']);
    expect(away.exitCode, `E2.07: ${away.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'E2.07: migrate').toBe(0);
    await emit(ctx, SWAPPED, 'E2.08');
    const back = await runMigrationPlan(ctx, [
      '--name',
      'swap',
      '--from',
      latestMigrationDirName(ctx),
      '--json',
    ]);
    expect(back.exitCode, `E2.09: ${back.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'E2.09: migrate').toBe(0);

    expect(await documents(dbName)).toEqual(SWAPPED_DOCUMENTS);
    await verifiedAndSettled(ctx, dbName, 'E2', furtherMigrationPlan(ctx));
  });

  it('E3: --delete removes the value from an optional field and key and from a list, with both commands', async () => {
    const journey: Journey = {
      before: BEFORE,
      after: REMOVED,
      documents: DOCUMENTS,
      statements: ['--delete', 'Status.ARCHIVED'],
    };
    const removed = [
      { email: 'a@example.com', tags: ['active'], home: { street: 'Main St' } },
      { email: 'b@example.com', status: 'active', tags: [], home: null },
      { email: 'c@example.com', tags: ['active'] },
    ];

    const planned = await throughMigrationPlan('mongo_e3_plan', journey, 'E3');
    expect(planned.documents).toEqual(removed);
    expect(await throughDbUpdate('mongo_e3_update', journey, 'E3')).toEqual(removed);
  });

  it('E4: --delete stops while a required field holds the value, advises a rename, and applies once the documents change', async () => {
    const journey: Journey = {
      before: usersPsl('  ACTIVE = "active"\n  ARCHIVED = "archived"', true),
      after: usersPsl('  ACTIVE = "active"', true),
      documents: [
        { email: 'a@example.com', status: 'archived', tags: [], home: null },
        { email: 'b@example.com', status: 'archived', tags: [], home: null },
        { email: 'c@example.com', status: 'active', tags: [], home: null },
      ],
      statements: ['--delete', 'Status.ARCHIVED'],
    };
    const dbName = 'mongo_e4_plan';
    const { ctx, origin } = await migratedThenChanged(dbName, journey, 'E4');
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'change',
      '--from',
      origin,
      ...journey.statements,
      '--json',
    ]);
    expect(planned.exitCode, `E4.05: ${planned.stdout}\n${planned.stderr}`).toBe(0);
    await expectMigrationTsReproducesOps(
      ctx,
      join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx)),
      'E4.06',
    );

    const stopped = await runMigrate(ctx, ['--json']);
    const failure = engineError(stopped);
    expect({
      exitCode: stopped.exitCode === 0 ? 0 : 'failed',
      code: failure?.code,
      summary: failure?.summary,
      why: failure?.why?.replace(/ObjectId\("[0-9a-f]{24}"\)/, 'ObjectId(<id>)'),
      advice: (failure?.nextActions ?? []).map(({ label }) => label),
      documents: await documents(dbName),
    }).toEqual({
      exitCode: 'failed',
      code: 'MIGRATION.PRECHECK_FAILED',
      summary: expect.stringContaining(
        '2 documents in collection users hold value "archived" in field status, which is required',
      ),
      why: expect.stringContaining(
        'One of them has _id ObjectId(<id>). Find them all with db.getCollection("users").find(',
      ),
      advice: expect.arrayContaining([expect.stringContaining('--rename')]),
      documents: journey.documents,
    });

    await client
      .db(dbName)
      .collection('users')
      .updateMany(
        { status: 'archived' },
        { $set: { status: 'active' } },
        {
          bypassDocumentValidation: true,
        },
      );
    const rerun = await runMigrate(ctx);
    expect(rerun.exitCode, `E4.08: re-run: ${rerun.stdout}\n${rerun.stderr}`).toBe(0);
    expect(await documents(dbName)).toEqual([
      { email: 'a@example.com', status: 'active', tags: [], home: null },
      { email: 'b@example.com', status: 'active', tags: [], home: null },
      { email: 'c@example.com', status: 'active', tags: [], home: null },
    ]);
    await verifiedAndSettled(ctx, dbName, 'E4', furtherMigrationPlan(ctx));
  });

  it('E5: without an origin contract nothing is rewritten, and the document check stops db update while documents hold the removed value', async () => {
    const dbName = 'mongo_e5_update';
    const ctx = setup(dbName);
    await emit(ctx, BEFORE, 'E5.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'E5.02').toBe(0);
    await seed(dbName, DOCUMENTS);
    rmSync(join(ctx.testDir, 'migrations'), { recursive: true, force: true });
    await emit(ctx, REMOVED, 'E5.03');

    const stopped = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    const failure = engineError(stopped);
    expect({
      exitCode: stopped.exitCode === 0 ? 0 : 'failed',
      code: failure?.code,
      summary: failure?.summary,
      documents: await documents(dbName),
    }).toEqual({
      exitCode: 'failed',
      code: 'MIGRATION.PRECHECK_FAILED',
      summary: expect.stringContaining('not fit the new validator'),
      documents: DOCUMENTS,
    });
  });

  it('E6: two values that trade places are refused under db update, and the route through values no member stores swaps them', async () => {
    const dbName = 'mongo_e6_update';
    const ctx = setup(dbName);
    await emit(ctx, BEFORE, 'E6.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'E6.02').toBe(0);
    await seed(dbName, DOCUMENTS);
    await emit(ctx, SWAPPED, 'E6.03');

    const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect({ error: engineError(refused), documents: await documents(dbName) }).toEqual({
      error: planningFailure(SWAP_REFUSAL),
      documents: DOCUMENTS,
    });

    await emit(ctx, THROUGH_SWAP, 'E6.04');
    const first = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(first.exitCode, `E6.05: ${JSON.stringify(engineError(first))}`).toBe(0);
    await emit(ctx, SWAPPED, 'E6.06');
    const second = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(second.exitCode, `E6.07: ${JSON.stringify(engineError(second))}`).toBe(0);

    expect(await documents(dbName)).toEqual(SWAPPED_DOCUMENTS);
    await verifiedAndSettled(ctx, dbName, 'E6', async () => {
      const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });
  });

  it('E7: a member that takes the stored value of a removed member is refused as a merge, and the route removes that member first', async () => {
    const dbName = 'mongo_e7_update';
    const ctx = setup(dbName);
    const merged = usersPsl('  ACTIVE = "archived"');
    await emit(ctx, BEFORE, 'E7.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'E7.02').toBe(0);
    await seed(dbName, DOCUMENTS);
    await emit(ctx, merged, 'E7.03');

    const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(engineError(refused), 'E7.04: the merge is refused').toEqual(
      planningFailure({
        summary:
          'Cannot change the stored value of enum value "Status.ACTIVE" from "active" to "archived": the origin enum stores "archived" as enum value "Status.ARCHIVED"',
        why: 'A changed stored value is rewritten in every document that holds it, so the documents of "Status.ACTIVE" would hold "archived" as the documents of "Status.ARCHIVED" do, and their data would merge. Make the change in two plans: first remove enum value "Status.ARCHIVED", and plan and apply that; then give "Status.ACTIVE" the stored value "archived", and plan again. The first plan asks about the documents that hold "archived". If you answer it with --delete Status.ARCHIVED, a required field cannot lose its value: before that plan applies, delete those documents in the database, or set them to "active" there to merge their data with the data of "Status.ACTIVE" on purpose.',
      }),
    );

    await emit(ctx, REMOVED, 'E7.05');
    const first = await runDbUpdate(ctx, [
      '--delete',
      'Status.ARCHIVED',
      '--no-interactive',
      '--json',
    ]);
    expect(first.exitCode, `E7.06: ${JSON.stringify(engineError(first))}`).toBe(0);
    await emit(ctx, merged, 'E7.07');
    const second = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(second.exitCode, `E7.08: ${JSON.stringify(engineError(second))}`).toBe(0);

    expect(await documents(dbName)).toEqual([
      { email: 'a@example.com', tags: ['archived'], home: { street: 'Main St' } },
      { email: 'b@example.com', status: 'archived', tags: [], home: null },
      { email: 'c@example.com', tags: ['archived'] },
    ]);
    await verifiedAndSettled(ctx, dbName, 'E7', async () => {
      const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });
  });
});
