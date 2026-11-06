/**
 * Field type changes and new required fields on MongoDB collections that hold documents, through `migration plan` then `db migrate` and through `db update`.
 *
 * C1 converts `String` to `Int` with `--convert` and a filled update. C2 answers the same change with `--delete`, which casts the values. C3 does that for an optional field holding `null` or nothing. C4 casts `Int` to `Float` and to `Int64` with nothing asked. C5 changes `Int` to `Json` and `String` to `Bson`, which needs only the validator change. B1 adds a required field, filled with a temporary value. B2 fills a new required field with `--backfill`. B3 makes an optional field required with `--backfill`. B4 makes an optional field required without it, so the document check stops the apply. W1 gives a field an enum, which plans no rewrite and warns. Every journey that applies ends with an empty further plan and a clean `db verify --schema-only`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Document, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

function usersPsl(fields: string): string {
  return `// use prisma-8
${fields.includes('Status') ? '\nenum Status {\n  active\n  paused\n}\n' : ''}
model User {
  id    ObjectId @id @map("_id")
  email String
${fields}

  @@map("users")
}
`;
}

interface Journey {
  readonly before: string;
  readonly after: string;
  readonly documents: readonly Document[];
  readonly statements?: readonly string[];
  /** The update a `--convert` or `--backfill` slot is filled with, by slot. */
  readonly fill?: { readonly slot: string; readonly update: string };
}

describe('Journeys (MongoDB): type changes and new required fields on documents', {
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
      `test-mongo-convert-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const outputDir = join(testDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    writeProjectManifest(testDir);
    const configPath = writeMongoPslConfig(testDir, url.toString());
    created.add(testDir);
    return { testDir, configPath, outputDir };
  }

  async function emitFields(ctx: JourneyContext, fields: string, label: string): Promise<void> {
    writeFileSync(join(ctx.testDir, 'contract.prisma'), usersPsl(fields), 'utf-8');
    const emitted = await runContractEmit(ctx);
    expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
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

  async function verifiedAndSettled(
    ctx: JourneyContext,
    label: string,
    further: () => Promise<readonly unknown[]>,
  ) {
    const verify = await runDbVerify(ctx, ['--schema-only']);
    expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
    expect(await further(), `${label}: a further plan is empty`).toEqual([]);
  }

  /** Plans the change with `migration plan`, fills its slot if it has one, applies it with `db migrate`, and returns the documents. */
  async function throughMigrationPlan(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName);
    await emitFields(ctx, journey.before, `${label}.01`);
    expect((await runMigrationPlan(ctx, ['--name', 'initial'])).exitCode, `${label}.02`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.03`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    await seed(dbName, journey.documents);

    await emitFields(ctx, journey.after, `${label}.04`);
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'change',
      '--from',
      origin,
      ...(journey.statements ?? []),
      '--json',
    ]);
    expect(planned.exitCode, `${label}.05: migration plan: ${planned.stderr}`).toBe(0);
    const migrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    if (journey.fill !== undefined) {
      const path = join(migrationDir, 'migration.ts');
      const slotCall = new RegExp(
        `placeholder\\(['"]${journey.fill.slot.replace('.', '\\.')}['"]\\)`,
      );
      writeFileSync(path, readFileSync(path, 'utf-8').replace(slotCall, journey.fill.update));
      const emitted = await selfEmitMigration(ctx, [
        '--dir',
        migrationDir,
        '--config',
        ctx.configPath,
      ]);
      expect(emitted.exitCode, `${label}.06: node migration.ts: ${emitted.stderr}`).toBe(0);
    }
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `${label}.07: db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(
      0,
    );
    const changed = latestMigrationDirName(ctx);
    await verifiedAndSettled(ctx, label, async () => {
      const further = await runMigrationPlan(ctx, ['--from', changed, '--json']);
      return parseJsonOutput<{ operations: readonly unknown[] }>(further).operations;
    });
    return { documents: await documents(dbName), planned: parseJsonOutput(planned) };
  }

  /** Applies the change with `db update` and returns the documents and the output. */
  async function throughDbUpdate(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName);
    await emitFields(ctx, journey.before, `${label}.11`);
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, `${label}.12`).toBe(0);
    await seed(dbName, journey.documents);

    await emitFields(ctx, journey.after, `${label}.13`);
    const updated = await runDbUpdate(ctx, [
      '--no-interactive',
      '--json',
      ...(journey.statements ?? []),
    ]);
    expect(updated.exitCode, `${label}.14: db update: ${updated.stdout}\n${updated.stderr}`).toBe(
      0,
    );
    await verifiedAndSettled(ctx, label, async () => {
      const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });
    return { documents: await documents(dbName), updated: parseJsonOutput(updated) };
  }

  it('C1: --convert writes a data transform, and the filled update converts the values', async () => {
    const result = await throughMigrationPlan(
      'mongo_c1_plan',
      {
        before: '  age   String',
        after: '  age   Int',
        documents: [
          { email: 'a@example.com', age: '42' },
          { email: 'b@example.com', age: 'forty' },
        ],
        statements: ['--convert', 'User.age'],
        fill: {
          slot: 'User.age:update',
          update: "[{ $set: { age: { $convert: { input: '$age', to: 'int', onError: 0 } } } }]",
        },
      },
      'C1',
    );

    expect(result.documents).toEqual([
      { email: 'a@example.com', age: 42 },
      { email: 'b@example.com', age: 0 },
    ]);
  });

  it('C2: --delete casts a required field with both commands', async () => {
    const journey: Journey = {
      before: '  age   String',
      after: '  age   Int',
      documents: [
        { email: 'a@example.com', age: '42' },
        { email: 'b@example.com', age: '7' },
      ],
      statements: ['--delete', 'User.age'],
    };
    const cast = [
      { email: 'a@example.com', age: 42 },
      { email: 'b@example.com', age: 7 },
    ];

    expect((await throughMigrationPlan('mongo_c2_plan', journey, 'C2')).documents).toEqual(cast);
    expect((await throughDbUpdate('mongo_c2_update', journey, 'C2')).documents).toEqual(cast);
  });

  it('C3: --delete casts an optional field and leaves null and missing values', async () => {
    const journey: Journey = {
      before: '  age   String?',
      after: '  age   Int?',
      documents: [
        { email: 'a@example.com', age: '42' },
        { email: 'b@example.com', age: null },
        { email: 'c@example.com' },
      ],
      statements: ['--delete', 'User.age'],
    };
    const cast = [
      { email: 'a@example.com', age: 42 },
      { email: 'b@example.com', age: null },
      { email: 'c@example.com' },
    ];

    expect((await throughMigrationPlan('mongo_c3_plan', journey, 'C3')).documents).toEqual(cast);
    expect((await throughDbUpdate('mongo_c3_update', journey, 'C3')).documents).toEqual(cast);
  });

  it('C4: a cast that keeps every value is planned with nothing asked', async () => {
    const journey: Journey = {
      before: '  ratio Int\n  big   Int',
      after: '  ratio Float\n  big   Int64',
      documents: [{ email: 'a@example.com', ratio: 3, big: 4 }],
    };
    const types = async (dbName: string) =>
      client
        .db(dbName)
        .collection('users')
        .aggregate([{ $project: { _id: 0, ratio: { $type: '$ratio' }, big: { $type: '$big' } } }])
        .toArray();

    await throughMigrationPlan('mongo_c4_plan', journey, 'C4');
    expect(await types('mongo_c4_plan')).toEqual([{ ratio: 'double', big: 'long' }]);
    await throughDbUpdate('mongo_c4_update', journey, 'C4');
    expect(await types('mongo_c4_update')).toEqual([{ ratio: 'double', big: 'long' }]);
  });

  it('C5: a new type that takes every old value changes only the validator', async () => {
    const journey: Journey = {
      before: '  meta  Int\n  blob  String',
      after: '  meta  Json\n  blob  Bson',
      documents: [{ email: 'a@example.com', meta: 3, blob: 'x' }],
    };
    const kept = [{ email: 'a@example.com', meta: 3, blob: 'x' }];

    const planned = await throughMigrationPlan('mongo_c5_plan', journey, 'C5');
    expect({
      documents: planned.documents,
      operations: Reflect.get(planned.planned, 'operations'),
    }).toMatchObject({
      documents: kept,
      operations: [{ id: 'validator.users.update' }],
    });
    expect((await throughDbUpdate('mongo_c5_update', journey, 'C5')).documents).toEqual(kept);
  });

  it('B1: a new required field gets a temporary value with both commands, and is reported', async () => {
    const journey: Journey = {
      before: '',
      after: '  plan  String',
      documents: [{ email: 'a@example.com' }, { email: 'b@example.com', plan: null }],
    };
    const filled = [
      { email: 'a@example.com', plan: '' },
      { email: 'b@example.com', plan: '' },
    ];

    const planned = await throughMigrationPlan('mongo_b1_plan', journey, 'B1');
    const updated = await throughDbUpdate('mongo_b1_update', journey, 'B1');
    expect({
      planned: planned.documents,
      updated: updated.documents,
      reported: [
        Reflect.get(planned.planned, 'temporaryValues'),
        Reflect.get(updated.updated, 'temporaryValues'),
      ],
    }).toEqual({
      planned: filled,
      updated: filled,
      reported: [[{ field: 'User.plan', value: '""' }], [{ field: 'User.plan', value: '""' }]],
    });
  });

  it('B2: --backfill writes a data transform that fills a new required field', async () => {
    const result = await throughMigrationPlan(
      'mongo_b2_plan',
      {
        before: '',
        after: '  plan  String',
        documents: [{ email: 'a@example.com' }],
        statements: ['--backfill', 'User.plan'],
        fill: { slot: 'User.plan:update', update: "{ $set: { plan: 'free' } }" },
      },
      'B2',
    );

    expect(result.documents).toEqual([{ email: 'a@example.com', plan: 'free' }]);
  });

  it('B3: --backfill fills an optional field made required', async () => {
    const result = await throughMigrationPlan(
      'mongo_b3_plan',
      {
        before: '  plan  String?',
        after: '  plan  String',
        documents: [
          { email: 'a@example.com', plan: null },
          { email: 'b@example.com', plan: 'pro' },
        ],
        statements: ['--backfill', 'User.plan'],
        fill: { slot: 'User.plan:update', update: "{ $set: { plan: 'free' } }" },
      },
      'B3',
    );

    expect(result.documents).toEqual([
      { email: 'a@example.com', plan: 'free' },
      { email: 'b@example.com', plan: 'pro' },
    ]);
  });

  it('B4: an optional field made required without --backfill stops at the document check', async () => {
    const ctx = setup('mongo_b4_update');
    await emitFields(ctx, '  plan  String?', 'B4.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'B4.02').toBe(0);
    await seed('mongo_b4_update', [{ email: 'a@example.com' }]);

    await emitFields(ctx, '  plan  String', 'B4.03');
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    const error = engineError(updated);

    expect({
      exitCode: updated.exitCode === 0 ? 0 : 'failed',
      code: error?.code,
      summary: error?.summary,
      touched: String(error?.why).split('. ')[0],
    }).toEqual({
      exitCode: 'failed',
      code: 'MIGRATION.PRECHECK_FAILED',
      summary:
        'Operation validator.users.update stopped: 1 document in collection users does not fit the new validator',
      touched: 'This validator change makes "plan" required',
    });
  });

  it('W1: a field that gains an enum is not rewritten, and db update warns', async () => {
    const result = await throughDbUpdate(
      'mongo_w1_update',
      {
        before: '  status String',
        after: '  status Status',
        documents: [{ email: 'a@example.com', status: 'active' }],
      },
      'W1',
    );

    expect({
      documents: result.documents,
      warnings: JSON.stringify(Reflect.get(result.updated, 'warnings') ?? result.updated),
    }).toMatchObject({
      documents: [{ email: 'a@example.com', status: 'active' }],
      warnings: expect.stringContaining('Field \\"User.status\\" gains enum \\"Status\\"'),
    });
  });
});
