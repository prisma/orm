/**
 * Variant statements on a MongoDB collection that holds documents, through `migration plan` then `db migrate`, and through `db update`.
 *
 * `Task` is stored in collection `tasks` and discriminated by `type`. `Bug` (`bug`, with `severity`) and `Epic` (`epic`, with `scope`) are its variants.
 *
 * V1: the value of `Bug` becomes `defect`. Without a statement both commands ask, offering `--convert Bug` first and `--delete Bug` second; `--convert Bug` rewrites the documents. V2: `Bug` is renamed to `Defect`, whose value is `defect`: `--rename Bug:Defect` rewrites the documents. V3: `Bug` is removed: it is asked about as the model, and `--delete Bug` deletes its documents and keeps the others. V4: `Bug` is removed and `Epic` takes `bug`: the plan is refused with advice to use two migrations, and two migrations then delete the documents of `Bug` and move `Epic` to `bug`. V5: without a snapshot of the origin contract `db update` rewrites nothing, and the validator's document check stops it while documents hold `bug`. V6: the discriminator is renamed to `kind` and the value of `Bug` becomes `defect`: planned without statements, with `--convert Bug --delete Task.type`, or with `--delete Task.type --delete Bug`, and through `db update`, the plan is refused because a temporary value would name no variant, offering `--rename Task.type:Task.kind`, and nothing is applied; the plan with that rename and `--convert Bug` keeps every document's variant. V7: the discriminator is renamed and `Bug` is renamed to `Defect`: the refusal offers the discriminator rename, the question that follows offers `--rename Bug:Defect` before `--delete Bug`, and following both keeps every document. V8: `Task` has no discriminator and gains `type` with its variants: `db update` applies it on an empty collection, and on a collection with a document the validator's document check stops it before anything changes, offering `--backfill Task.type` and not an optional discriminator, which the contract cannot have. V10: the same change through `migration plan` and `db migrate` stops at the document check, whose steps say to delete the migration that stopped and give the `migration plan` command, with `--from` and `--backfill Task.type`, that plans it again. V9: `kind` becomes the discriminator and `type` stays as a field: `db update` is stopped by the document check, which names `kind` as required and `--backfill Task.kind`. V11: `Task` gains its first discriminator and `Bug` a required `severity`: the stop names `--backfill Task.type` only, says its update can set `severity` too, and offers no optional discriminator; following it under `db update` and under `db migrate` gives each document both fields.
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
  selfEmitMigration,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

interface Variant {
  readonly name: string;
  readonly value: string;
  readonly field: string;
}

function tasksPsl(variants: readonly Variant[], discriminator = 'type'): string {
  const models = variants.map(
    ({ name, value, field }) => `
model ${name} {
  id     ObjectId @id @map("_id")
  ${field} String?

  @@base(Task, "${value}")
}
`,
  );
  return `// use prisma-8

model Task {
  id    ObjectId @id @map("_id")
  title String
  ${discriminator} String

  @@discriminator(${discriminator})
  @@map("tasks")
}
${models.join('')}`;
}

const BUG: Variant = { name: 'Bug', value: 'bug', field: 'severity' };
const EPIC: Variant = { name: 'Epic', value: 'epic', field: 'scope' };

const BEFORE = tasksPsl([BUG, EPIC]);
const CHANGED = tasksPsl([{ ...BUG, value: 'defect' }, EPIC]);
const RENAMED = tasksPsl([{ ...BUG, name: 'Defect', value: 'defect' }, EPIC]);
const REMOVED = tasksPsl([EPIC]);
const TAKEN = tasksPsl([{ ...EPIC, value: 'bug' }]);
const KIND_CHANGED = tasksPsl([{ ...BUG, value: 'defect' }, EPIC], 'kind');
const KIND_RENAMED = tasksPsl([{ ...BUG, name: 'Defect', value: 'defect' }, EPIC], 'kind');
const KIND_BESIDE_TYPE = BEFORE.replace(
  '  type String\n\n  @@discriminator(type)',
  '  type String\n  kind String\n\n  @@discriminator(kind)',
);
const SEVERITY_REQUIRED = BEFORE.replace('severity String?', 'severity String');
const PLAIN = `// use prisma-8

model Task {
  id    ObjectId @id @map("_id")
  title String
  type  String?

  @@map("tasks")
}
`;

const TAKEN_VALUE_WHY =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a value another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first delete the variants, or move their values to discriminator values no variant uses; then change the values to their final ones.";

const DOCUMENTS: readonly Document[] = [
  { title: 'a', type: 'bug', severity: 'high' },
  { title: 'b', type: 'epic', scope: 'all' },
  { title: 'c', type: 'bug' },
];

const DEFECTS = [
  { title: 'a', type: 'defect', severity: 'high' },
  { title: 'b', type: 'epic', scope: 'all' },
  { title: 'c', type: 'defect' },
];

interface Journey {
  readonly before: string;
  readonly after: string;
  readonly statements: readonly string[];
}

describe('Journeys (MongoDB): variant statements', {
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
      `test-mongo-variant-statements-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      .collection('tasks')
      .find({}, { projection: { _id: 0 }, sort: { title: 1 } })
      .toArray();
  }

  async function seed(dbName: string): Promise<void> {
    await client
      .db(dbName)
      .collection('tasks')
      .insertMany(DOCUMENTS.map((row) => ({ ...row })));
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
    const tasks = client.db(dbName).collection('tasks');
    const count = await tasks.countDocuments();
    const updated = await tasks.updateMany({}, [
      { $set: { title: { $concat: ['$title', '.updated'] } } },
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
    await seed(dbName);
    await emit(ctx, journey.after, `${label}.04`);
    return { ctx, origin };
  }

  /** Plans with `statements`, re-runs the `migration.ts`, applies it with `db migrate`, and returns the `migration.ts`. */
  async function planAndMigrate(
    ctx: JourneyContext,
    from: string,
    name: string,
    statements: readonly string[],
    label: string,
  ): Promise<string> {
    const planned = await runMigrationPlan(ctx, [
      '--name',
      name,
      '--from',
      from,
      ...statements,
      '--json',
    ]);
    expect(planned.exitCode, `${label}: migration plan: ${planned.stdout}\n${planned.stderr}`).toBe(
      0,
    );
    const migrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    await expectMigrationTsReproducesOps(ctx, migrationDir, `${label}: re-run migration.ts`);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `${label}: db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
    return readFileSync(join(migrationDir, 'migration.ts'), 'utf-8');
  }

  /** Plans the change with `migration plan`, applies it with `db migrate`, and returns the documents and the `migration.ts`. */
  async function throughMigrationPlan(dbName: string, journey: Journey, label: string) {
    const { ctx, origin } = await migratedThenChanged(dbName, journey, label);
    const migrationTs = await planAndMigrate(ctx, origin, 'change', journey.statements, label);
    const after = await documents(dbName);
    await verifiedAndSettled(ctx, dbName, label, furtherMigrationPlan(ctx));
    return { documents: after, migrationTs };
  }

  /** Applies the change with `db update` and returns the documents. */
  async function throughDbUpdate(dbName: string, journey: Journey, label: string) {
    const ctx = setup(dbName);
    await emit(ctx, journey.before, `${label}.11`);
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, `${label}.12`).toBe(0);
    await seed(dbName);
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

  /** The question the emitted contract raises without statements, through `migration plan` and through `db update`. */
  async function asked(dbName: string, journey: Journey, label: string) {
    const { ctx, origin } = await migratedThenChanged(dbName, journey, label);
    const planned = await runMigrationPlan(ctx, ['--from', origin, '--json']);
    expect(planned.exitCode, `${label}: migration plan asks`).not.toBe(0);
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(updated.exitCode, `${label}: db update asks`).not.toBe(0);
    return [JSON.stringify(engineError(planned)), JSON.stringify(engineError(updated))];
  }

  /** The variant calls of a `migration.ts`, without white space. */
  function variantCalls(migrationTs: string): readonly string[] {
    return (
      migrationTs
        .replace(/\s+/g, '')
        .replace(/,(?=[}\]])/g, '')
        .match(/(?:replaceStoredValue|deleteDocuments)\(\{(?:[^{}]|\{[^{}]*\})*\}\)/g) ?? []
    );
  }

  it('V1: a changed discriminator value is asked about, and --convert Bug rewrites the documents, with both commands', async () => {
    const journey: Journey = { before: BEFORE, after: CHANGED, statements: ['--convert', 'Bug'] };
    for (const question of await asked('mongo_v1_asked', journey, 'V1')) {
      expect({
        convert: question.indexOf('--convert Bug') >= 0,
        convertFirst: question.indexOf('--convert Bug') < question.indexOf('--delete Bug'),
      }).toEqual({ convert: true, convertFirst: true });
    }

    const planned = await throughMigrationPlan('mongo_v1_plan', journey, 'V1');
    expect({
      documents: planned.documents,
      calls: variantCalls(planned.migrationTs),
    }).toEqual({
      documents: DEFECTS,
      calls: [
        "replaceStoredValue({collection:'tasks',field:'type',from:'bug',to:{$literal:'defect'}})",
      ],
    });
    expect(await throughDbUpdate('mongo_v1_update', journey, 'V1')).toEqual(DEFECTS);
  });

  it('V2: --rename Bug:Defect rewrites the documents to the new value, with both commands', async () => {
    const journey: Journey = {
      before: BEFORE,
      after: RENAMED,
      statements: ['--rename', 'Bug:Defect'],
    };
    const planned = await throughMigrationPlan('mongo_v2_plan', journey, 'V2');
    expect(planned.documents).toEqual(DEFECTS);
    expect(await throughDbUpdate('mongo_v2_update', journey, 'V2')).toEqual(DEFECTS);
  });

  it('V3: a removed variant is asked about as the model, and --delete Bug deletes its documents and keeps the others, with both commands', async () => {
    const journey: Journey = { before: BEFORE, after: REMOVED, statements: ['--delete', 'Bug'] };
    for (const question of await asked('mongo_v3_asked', journey, 'V3')) {
      expect({
        delete: question.includes('--delete Bug'),
        perField: question.includes('Bug.severity'),
      }).toEqual({ delete: true, perField: false });
    }
    const kept = [{ title: 'b', type: 'epic', scope: 'all' }];

    const planned = await throughMigrationPlan('mongo_v3_plan', journey, 'V3');
    expect({
      documents: planned.documents,
      calls: variantCalls(planned.migrationTs),
    }).toEqual({
      documents: kept,
      calls: ["deleteDocuments({collection:'tasks',filter:{type:'bug'}})"],
    });
    expect(await throughDbUpdate('mongo_v3_update', journey, 'V3')).toEqual(kept);
  });

  it('V4: a removed variant whose value another variant takes is refused under both commands with advice to make the change in two steps, and two migrations succeed', async () => {
    const dbName = 'mongo_v4_plan';
    const { ctx, origin } = await migratedThenChanged(
      dbName,
      { before: BEFORE, after: TAKEN, statements: [] },
      'V4',
    );
    const refused = await runMigrationPlan(ctx, [
      '--name',
      'refused',
      '--from',
      origin,
      '--delete',
      'Bug',
      '--convert',
      'Epic',
      '--json',
    ]);
    const failure = engineError(refused);
    const updated = await runDbUpdate(ctx, [
      '--no-interactive',
      '--delete',
      'Bug',
      '--convert',
      'Epic',
      '--json',
    ]);
    expect({
      exitCode: refused.exitCode === 0 ? 0 : 'failed',
      text: JSON.stringify(failure),
      byHand: JSON.stringify(failure).includes('To write the rewrites by hand'),
      dbUpdateText: JSON.stringify(engineError(updated)),
    }).toEqual({
      exitCode: 'failed',
      text: expect.stringContaining(TAKEN_VALUE_WHY),
      byHand: false,
      dbUpdateText: expect.stringContaining(TAKEN_VALUE_WHY),
    });

    await emit(ctx, REMOVED, 'V4.05');
    await planAndMigrate(ctx, origin, 'delete-bug', ['--delete', 'Bug'], 'V4.06');
    await emit(ctx, TAKEN, 'V4.07');
    await planAndMigrate(
      ctx,
      latestMigrationDirName(ctx),
      'take-bug',
      ['--convert', 'Epic'],
      'V4.08',
    );

    expect(await documents(dbName)).toEqual([{ title: 'b', type: 'bug', scope: 'all' }]);
    await verifiedAndSettled(ctx, dbName, 'V4', furtherMigrationPlan(ctx));
  });

  it('V6: a discriminator renamed without its statement is refused with the rename to pass, whatever the other answers, and the plan with the rename keeps the variants', async () => {
    const dbName = 'mongo_v6_plan';
    const { ctx, origin } = await migratedThenChanged(
      dbName,
      { before: BEFORE, after: KIND_CHANGED, statements: [] },
      'V6',
    );
    const NEW_DISCRIMINATOR =
      'Cannot plan the migration: new discriminator field \\"Task.kind\\" has no value in the documents of collection tasks';
    const refusalOf = (result: Awaited<ReturnType<typeof runMigrationPlan>>) => {
      const text = JSON.stringify(engineError(result) ?? {});
      return {
        exitCode: result.exitCode === 0 ? 0 : 'failed',
        newDiscriminator: text.includes(NEW_DISCRIMINATOR),
        offered: [
          ...new Set([...text.matchAll(/add (--rename \S+) to keep it/g)].map(([, flag]) => flag)),
        ],
      };
    };
    const refused = {
      exitCode: 'failed',
      newDiscriminator: true,
      offered: ['--rename Task.type:Task.kind'],
    };
    const answers = [
      [],
      ['--convert', 'Bug', '--delete', 'Task.type'],
      ['--delete', 'Task.type', '--delete', 'Bug'],
    ];
    const planned = [];
    for (const statements of answers) {
      planned.push(
        refusalOf(await runMigrationPlan(ctx, ['--from', origin, ...statements, '--json'])),
      );
    }
    const updated = refusalOf(
      await runDbUpdate(ctx, [
        '--no-interactive',
        '--json',
        '--delete',
        'Task.type',
        '--convert',
        'Bug',
      ]),
    );
    expect({ planned, updated, documents: await documents(dbName) }).toEqual({
      planned: answers.map(() => refused),
      updated: refused,
      documents: DOCUMENTS,
    });

    const [rename] = refused.offered;
    await planAndMigrate(
      ctx,
      origin,
      'change',
      [...(rename ?? '').split(' '), '--convert', 'Bug'],
      'V6',
    );

    expect(await documents(dbName)).toEqual([
      { title: 'a', kind: 'defect', severity: 'high' },
      { title: 'b', kind: 'epic', scope: 'all' },
      { title: 'c', kind: 'defect' },
    ]);
    await verifiedAndSettled(ctx, dbName, 'V6', furtherMigrationPlan(ctx));
  });

  it('V7: with the discriminator and Bug both renamed, following the offers keeps every document: the refusal offers the discriminator rename, and the question then offers --rename Bug:Defect first', async () => {
    const dbName = 'mongo_v7_plan';
    const { ctx, origin } = await migratedThenChanged(
      dbName,
      { before: BEFORE, after: KIND_RENAMED, statements: [] },
      'V7',
    );
    const textOf = async (statements: readonly string[]) =>
      JSON.stringify(
        engineError(await runMigrationPlan(ctx, ['--from', origin, ...statements, '--json'])) ?? {},
      );
    const refused = await textOf([]);
    const [rename] = [...refused.matchAll(/add (--rename \S+) to keep it/g)].map(
      ([, flag]) => flag,
    );
    const renameStatements = (rename ?? '').split(' ');
    const question = await textOf(renameStatements);
    expect({
      rename,
      offersVariantRename: question.includes('--rename Bug:Defect'),
      renameFirst: question.indexOf('--rename Bug:Defect') < question.indexOf('--delete Bug'),
    }).toEqual({
      rename: '--rename Task.type:Task.kind',
      offersVariantRename: true,
      renameFirst: true,
    });

    await planAndMigrate(
      ctx,
      origin,
      'change',
      [...renameStatements, '--rename', 'Bug:Defect'],
      'V7',
    );

    expect(await documents(dbName)).toEqual([
      { title: 'a', kind: 'defect', severity: 'high' },
      { title: 'b', kind: 'epic', scope: 'all' },
      { title: 'c', kind: 'defect' },
    ]);
    await verifiedAndSettled(ctx, dbName, 'V7', furtherMigrationPlan(ctx));
  });

  it('V8: a model that gains its first discriminator is applied by db update on an empty collection, and stopped by the document check while a document has no value for it', async () => {
    const empty = setup('mongo_v8_empty');
    await emit(empty, PLAIN, 'V8.01');
    expect((await runDbUpdate(empty, ['--no-interactive'])).exitCode, 'V8.02').toBe(0);
    await emit(empty, BEFORE, 'V8.03');
    const applied = await runDbUpdate(empty, ['--no-interactive', '--json']);
    expect(applied.exitCode, `V8.04: ${applied.stdout}\n${applied.stderr}`).toBe(0);
    await verifiedAndSettled(empty, 'mongo_v8_empty', 'V8', async () => {
      const further = await runDbUpdate(empty, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });

    const held = setup('mongo_v8_held');
    await emit(held, PLAIN, 'V8.11');
    expect((await runDbUpdate(held, ['--no-interactive'])).exitCode, 'V8.12').toBe(0);
    await client.db('mongo_v8_held').collection('tasks').insertOne({ title: 'a' });
    await emit(held, BEFORE, 'V8.13');
    const stopped = await runDbUpdate(held, ['--no-interactive', '--json']);
    const failure = engineError(stopped);
    expect({
      exitCode: stopped.exitCode === 0 ? 0 : 'failed',
      code: failure?.code,
      summary: failure?.summary,
      text: JSON.stringify(failure ?? {}),
      advice: failure?.nextActions?.map(({ label }) => label),
      documents: await documents('mongo_v8_held'),
    }).toEqual({
      exitCode: 'failed',
      code: 'MIGRATION.PRECHECK_FAILED',
      summary: expect.stringContaining('not fit the new validator'),
      text: expect.stringContaining('--backfill Task.type'),
      advice: [expect.stringMatching(/^Plan it with `[^`]*migration plan --backfill Task\.type`/)],
      documents: [{ title: 'a' }],
    });
  });

  it('V10: under db migrate, the stop for a first discriminator says to delete the migration that stopped and plan it again from its origin with --backfill Task.type, and that command plans', async () => {
    const dbName = 'mongo_v10_migrate';
    const ctx = setup(dbName);
    await emit(ctx, PLAIN, 'V10.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `V10.02: ${initial.stdout}\n${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'V10.03').toBe(0);
    const origin = latestMigrationDirName(ctx);
    await client.db(dbName).collection('tasks').insertOne({ title: 'a' });
    await emit(ctx, BEFORE, 'V10.04');
    const planned = await runMigrationPlan(ctx, ['--name', 'disc', '--from', origin]);
    expect(planned.exitCode, `V10.05: ${planned.stdout}\n${planned.stderr}`).toBe(0);
    const stoppedDir = latestMigrationDirName(ctx);

    const failure = engineError(await runMigrate(ctx, ['--json']));
    const advice = failure?.nextActions?.map(({ label }) => label).join('\n') ?? '';
    const command = /`[^`]*migration plan (--from \S+ --name disc --backfill Task\.type)`/.exec(
      advice,
    )?.[1];
    expect({
      code: failure?.code,
      deletesStopped: new RegExp(`delete \`[^\`]*${stoppedDir}\``).test(advice),
      command,
      documents: await documents(dbName),
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      deletesStopped: true,
      command: expect.stringContaining('--backfill Task.type'),
      documents: [{ title: 'a' }],
    });

    rmSync(join(ctx.testDir, 'migrations/app', stoppedDir), { recursive: true, force: true });
    const replanned = await runMigrationPlan(ctx, (command ?? '').split(' '));
    expect(replanned.exitCode, `V10.07: ${replanned.stdout}\n${replanned.stderr}`).toBe(0);
  });

  /** Writes `update` into the slot of the backfill of `Task.type` in the latest migration, runs the file, and applies it with `db migrate`. */
  async function fillTypeBackfillAndMigrate(ctx: JourneyContext, update: string, label: string) {
    const migrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const path = join(migrationDir, 'migration.ts');
    writeFileSync(
      path,
      readFileSync(path, 'utf-8').replace(/placeholder\(['"]Task\.type:update['"]\)/, update),
    );
    const emitted = await selfEmitMigration(ctx, [
      '--dir',
      migrationDir,
      '--config',
      ctx.configPath,
    ]);
    expect(emitted.exitCode, `${label}: node migration.ts: ${emitted.stderr}`).toBe(0);
    await expectMigrationTsReproducesOps(ctx, migrationDir, label);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `${label}: db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
  }

  const NEW_VARIANT_FIELD_ADVICE =
    'The update you write for --backfill Task.type can also set \\"severity\\" in the documents it gives value \\"bug\\", such as { $set: { type: \\"bug\\", severity: <value> } }.';
  const SET_BOTH = "{ $set: { type: 'bug', severity: 'low' } }";
  const BUGS = [
    { title: 'a', type: 'bug', severity: 'low' },
    { title: 'b', type: 'bug', severity: 'low' },
  ];

  it('V11: a first discriminator whose new variant has a required field: the stop names --backfill Task.type only, and its update setting both fields applies, under db update and under db migrate', async () => {
    const updated = setup('mongo_v11_update');
    await emit(updated, PLAIN, 'V11.01');
    expect((await runDbUpdate(updated, ['--no-interactive'])).exitCode, 'V11.02').toBe(0);
    await client
      .db('mongo_v11_update')
      .collection('tasks')
      .insertMany([{ title: 'a' }, { title: 'b' }]);
    await emit(updated, SEVERITY_REQUIRED, 'V11.03');
    const stopped = engineError(await runDbUpdate(updated, ['--no-interactive', '--json']));
    const steps = stopped?.nextActions?.map(({ label }) => label) ?? [];
    const command = /`[^`]*migration plan ([^`]*)`/.exec(steps[0] ?? '')?.[1];
    expect({
      code: stopped?.code,
      advice: JSON.stringify(stopped ?? {}).includes(NEW_VARIANT_FIELD_ADVICE),
      command,
      steps: steps.length,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      advice: true,
      command: expect.stringMatching(/^(--from \S+ )?--backfill Task\.type$/),
      steps: 1,
    });
    const planned = await runMigrationPlan(updated, (command ?? '').split(' '));
    expect(planned.exitCode, `V11.04: ${planned.stdout}\n${planned.stderr}`).toBe(0);
    await fillTypeBackfillAndMigrate(updated, SET_BOTH, 'V11.05');
    expect(await documents('mongo_v11_update')).toEqual(BUGS);
    await verifiedAndSettled(updated, 'mongo_v11_update', 'V11.06', async () => {
      const further = await runDbUpdate(updated, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });

    const migrated = setup('mongo_v11_migrate');
    await emit(migrated, PLAIN, 'V11.11');
    expect((await runMigrationPlan(migrated, ['--name', 'initial'])).exitCode, 'V11.12').toBe(0);
    expect((await runMigrate(migrated)).exitCode, 'V11.13').toBe(0);
    const origin = latestMigrationDirName(migrated);
    await client
      .db('mongo_v11_migrate')
      .collection('tasks')
      .insertMany([{ title: 'a' }, { title: 'b' }]);
    await emit(migrated, SEVERITY_REQUIRED, 'V11.14');
    expect(
      (await runMigrationPlan(migrated, ['--name', 'disc', '--from', origin])).exitCode,
      'V11.15',
    ).toBe(0);
    const stoppedDir = latestMigrationDirName(migrated);
    const failure = engineError(await runMigrate(migrated, ['--json']));
    const replan = /`[^`]*migration plan (--from \S+ --name disc --backfill Task\.type)`/.exec(
      failure?.nextActions?.map(({ label }) => label).join('\n') ?? '',
    )?.[1];
    expect({
      code: failure?.code,
      advice: JSON.stringify(failure ?? {}).includes(NEW_VARIANT_FIELD_ADVICE),
      replan,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      advice: true,
      replan: expect.stringContaining('--backfill Task.type'),
    });
    rmSync(join(migrated.testDir, 'migrations/app', stoppedDir), { recursive: true, force: true });
    const replanned = await runMigrationPlan(migrated, (replan ?? '').split(' '));
    expect(replanned.exitCode, `V11.16: ${replanned.stdout}\n${replanned.stderr}`).toBe(0);
    await fillTypeBackfillAndMigrate(migrated, SET_BOTH, 'V11.17');
    expect(await documents('mongo_v11_migrate')).toEqual(BUGS);
    await verifiedAndSettled(
      migrated,
      'mongo_v11_migrate',
      'V11.18',
      furtherMigrationPlan(migrated),
    );
  });

  it('V9: a new discriminator beside the old one kept as a field is stopped by the document check, which names --backfill for the new one', async () => {
    expect(KIND_BESIDE_TYPE).toContain('@@discriminator(kind)');
    const ctx = setup('mongo_v9_update');
    await emit(ctx, BEFORE, 'V9.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'V9.02').toBe(0);
    await seed('mongo_v9_update');
    await emit(ctx, KIND_BESIDE_TYPE, 'V9.03');
    const stopped = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    const failure = engineError(stopped);
    expect({
      exitCode: stopped.exitCode === 0 ? 0 : 'failed',
      code: failure?.code,
      text: JSON.stringify(failure ?? {}),
      documents: await documents('mongo_v9_update'),
    }).toEqual({
      exitCode: 'failed',
      code: 'MIGRATION.PRECHECK_FAILED',
      text: expect.stringMatching(
        /This validator change makes \\"kind\\" required.*--backfill Task\.kind/,
      ),
      documents: DOCUMENTS,
    });
  });

  it('V5: without an origin contract nothing is rewritten, and the document check stops db update while documents hold the old value', async () => {
    const dbName = 'mongo_v5_update';
    const ctx = setup(dbName);
    await emit(ctx, BEFORE, 'V5.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'V5.02').toBe(0);
    await seed(dbName);
    rmSync(join(ctx.testDir, 'migrations'), { recursive: true, force: true });
    await emit(ctx, CHANGED, 'V5.03');

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
});
