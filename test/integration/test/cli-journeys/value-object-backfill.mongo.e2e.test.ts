/**
 * A required field new inside a value object or an embedded model, on MongoDB collections that hold documents.
 *
 * `User.home` holds an `Address` or `null` or nothing, and `User.addresses` a list of them whose elements may be `null`.
 *
 * - B1: `migration plan --backfill Address.zip` writes one `fillStoredKey` per place `Address` is stored, whose value is `placeholder('Address.zip:value')`, and `ops.json` stays empty. `db update` refuses the statement. Once the value is written, `node migration.ts` and `db migrate` fill every object and leave `null`, missing and empty values alone.
 * - B2: `db update` fills `Address.zip` and `Address.floor` with typed temporary values and reports them. A new `Address.seen DateTime` has no temporary value, so the document check stops the apply and names `--backfill Address.seen`.
 * - B3: when `Address` also loses `zip`, the question offers `--rename Address.zip:Address.country` first and says the new field gets a temporary value. `--rename` plans the rename and no fill. `--delete Address.zip --backfill Address.country` writes the placeholder, and once it is filled the apply removes `zip` and fills `country`. A new `DateTime` field has no temporary value, so there the question says it still needs `--backfill`.
 * - B4: the same for a field of an embedded model, `Line.code`, in a one-to-many embed: `--backfill Line.code` with `migration plan`, and a temporary value with `db update`.
 *
 * Every journey that applies re-runs its `migration.ts` to reproduce `ops.json`, and ends with a clean `db verify --schema-only`, an empty further plan, and every document accepting an update.
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const FIXTURES_DIR = join(fixtureAppDir, 'fixtures/mongo-cli-journeys');

/** A PSL contract whose `User` documents hold an `Address` in `home` and a list of them in `addresses`. */
function usersPsl(addressMembers: string): string {
  return `// use prisma-8
type Address {
${addressMembers}
}

model User {
  id        ObjectId  @id @map("_id")
  email     String
  home      Address?
  addresses Address?[]

  @@map("users")
}
`;
}

const ADDRESS = usersPsl('  street String');
const ADDRESS_WITH_ZIP = usersPsl('  street String\n  zip    String');
const ADDRESS_WITH_FLOOR = usersPsl('  street String\n  zip    String\n  floor  Int');
const ADDRESS_WITH_FLOOR_SEEN = usersPsl(
  '  street String\n  zip    String\n  floor  Int\n  seen   DateTime',
);
const ADDRESS_WITH_COUNTRY = usersPsl('  street  String\n  country String');
const ADDRESS_WITH_SEEN = usersPsl('  street String\n  seen   DateTime');

/** Documents with an `Address` held once, in a list beside a `null` element, as `null`, missing, and in an empty list. */
const DOCUMENTS: readonly Document[] = [
  {
    email: 'a@example.com',
    home: { street: 'Main St' },
    addresses: [{ street: 'High St' }, null],
  },
  { email: 'b@example.com', home: null, addresses: [] },
  { email: 'c@example.com', addresses: [] },
];

/** A contract: PSL source, or the name of a TypeScript contract fixture. */
type Source = { readonly psl: string } | { readonly typescriptFixture: string };

describe('Journeys (MongoDB): required fields new inside value objects and embedded models', {
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
      `test-mongo-value-object-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
        name: 'mongo-value-object-backfill-journey',
        private: true,
        type: 'module',
        dependencies: { '@prisma/orm-mongo': 'workspace:0.16.0' },
      }),
      'utf-8',
    );
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

  async function settledByMigrationPlan(ctx: JourneyContext, dbName: string, label: string) {
    const changed = latestMigrationDirName(ctx);
    await verifiedAndSettled(ctx, dbName, label, async () => {
      const further = await runMigrationPlan(ctx, ['--from', changed, '--json']);
      return parseJsonOutput<{ operations: readonly unknown[] }>(further).operations;
    });
  }

  /** Creates the collection with the first contract through `migration plan` and `db migrate`, seeds it, and emits the second. Returns the origin migration. */
  async function migratedThenChanged(
    dbName: string,
    contracts: { readonly before: Source; readonly after: Source },
    rows: readonly Document[],
    label: string,
  ) {
    const ctx = setup(dbName, contracts.before);
    await emit(ctx, contracts.before, `${label}.01`);
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: ${initial.stdout}\n${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.03`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    await seed(dbName, rows);
    await emit(ctx, contracts.after, `${label}.04`);
    return { ctx, origin };
  }

  /** The fill calls of a `migration.ts`, without white space. */
  function fillCalls(migrationTs: string): readonly string[] {
    return (
      migrationTs
        .replace(/\s+/g, '')
        .replace(/,\}/g, '}')
        .match(/fillStoredKey\(\{.*?\}\)(?=,|\])/g) ?? []
    );
  }

  /** Writes `value` in place of every placeholder of `slot`, runs `migration.ts`, checks a re-run reproduces `ops.json`, and applies the migration. */
  async function filledAndApplied(
    ctx: JourneyContext,
    slot: string,
    value: string,
    label: string,
  ): Promise<void> {
    const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const path = join(dir, 'migration.ts');
    writeFileSync(path, readFileSync(path, 'utf-8').replaceAll(`placeholder('${slot}')`, value));
    const emitted = await selfEmitMigration(ctx, ['--dir', dir, '--config', ctx.configPath]);
    expect(
      emitted.exitCode,
      `${label}: node migration.ts: ${emitted.stdout}${emitted.stderr}`,
    ).toBe(0);
    await expectMigrationTsReproducesOps(ctx, dir, label);
    const applied = await runMigrate(ctx);
    expect(applied.exitCode, `${label}: db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
  }

  it('B1: migration plan --backfill Address.zip writes a placeholder at each place, db update refuses it, and the filled value reaches every object', async () => {
    const dbName = 'mongo_vo_b1';
    const { ctx, origin } = await migratedThenChanged(
      dbName,
      { before: { psl: ADDRESS }, after: { psl: ADDRESS_WITH_ZIP } },
      DOCUMENTS,
      'B1',
    );

    const refused = await runDbUpdate(ctx, [
      '--no-interactive',
      '--json',
      '--backfill',
      'Address.zip',
    ]);
    expect(engineError(refused)?.code, 'B1.05: db update refuses --backfill').toBe(
      'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
    );

    const planned = await runMigrationPlan(ctx, [
      '--name',
      'zip',
      '--from',
      origin,
      '--backfill',
      'Address.zip',
      '--json',
    ]);
    expect(planned.exitCode, `B1.06: migration plan: ${planned.stdout}\n${planned.stderr}`).toBe(0);
    const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    expect({
      pending: parseJsonOutput<{ pendingPlaceholders?: boolean }>(planned).pendingPlaceholders,
      calls: fillCalls(readFileSync(join(dir, 'migration.ts'), 'utf-8')),
      ops: JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')),
    }).toEqual({
      pending: true,
      calls: [
        "fillStoredKey({collection:'users',field:'addresses',path:'$[*].zip',value:placeholder('Address.zip:value')})",
        "fillStoredKey({collection:'users',field:'home',path:'$.zip',value:placeholder('Address.zip:value')})",
      ],
      ops: [],
    });

    await filledAndApplied(ctx, 'Address.zip:value', "{ $literal: '0150' }", 'B1.07');
    expect(await documents(dbName)).toEqual([
      {
        email: 'a@example.com',
        home: { street: 'Main St', zip: '0150' },
        addresses: [{ street: 'High St', zip: '0150' }, null],
      },
      { email: 'b@example.com', home: null, addresses: [] },
      { email: 'c@example.com', addresses: [] },
    ]);
    await settledByMigrationPlan(ctx, dbName, 'B1.08');
  });

  it('B2: db update fills typed temporary values inside a value object and reports them', async () => {
    const dbName = 'mongo_vo_b2';
    const ctx = setup(dbName, { psl: ADDRESS });
    await emit(ctx, { psl: ADDRESS }, 'B2.01');
    expect((await runDbUpdate(ctx, ['--no-interactive'])).exitCode, 'B2.02').toBe(0);
    await seed(dbName, DOCUMENTS);

    await emit(ctx, { psl: ADDRESS_WITH_FLOOR }, 'B2.03');
    const dryRun = await runDbUpdate(ctx, ['--dry-run', '--no-interactive']);
    expect(dryRun.exitCode, `B2.04: db update --dry-run: ${dryRun.stderr}`).toBe(0);
    expect(`${dryRun.stdout}${dryRun.stderr}`, 'B2.04: names each value').toMatch(
      /Field "Address\.zip" would get the temporary value "" where existing data has none\./,
    );
    const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
    expect(updated.exitCode, `B2.05: db update: ${updated.stdout}\n${updated.stderr}`).toBe(0);
    expect({
      reported: parseJsonOutput<{ temporaryValues: readonly unknown[] }>(updated).temporaryValues,
      documents: await documents(dbName),
      floorType: await client
        .db(dbName)
        .collection('users')
        .countDocuments({ 'home.floor': { $type: 'int' } }),
    }).toEqual({
      reported: [
        { field: 'Address.floor', value: '0' },
        { field: 'Address.zip', value: '""' },
      ],
      documents: [
        {
          email: 'a@example.com',
          home: { street: 'Main St', zip: '', floor: 0 },
          addresses: [{ street: 'High St', zip: '', floor: 0 }, null],
        },
        { email: 'b@example.com', home: null, addresses: [] },
        { email: 'c@example.com', addresses: [] },
      ],
      floorType: 1,
    });
    await verifiedAndSettled(ctx, dbName, 'B2.06', async () => {
      const further = await runDbUpdate(ctx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });

    await emit(ctx, { psl: ADDRESS_WITH_FLOOR_SEEN }, 'B2.07');
    const stopped = engineError(await runDbUpdate(ctx, ['--no-interactive', '--json']));
    expect(
      { code: stopped?.code, why: stopped?.why },
      'B2.08: a field with no temporary value stops at the document check, which names --backfill',
    ).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: expect.stringContaining(
        'To give "addresses.seen" and "home.seen" values you choose, plan the change with --backfill Address.seen, as the steps to take describe.',
      ),
    });
  });

  it('B3: a value object that also loses a field offers --rename first, and --delete with --backfill fills the new field', async () => {
    const dbName = 'mongo_vo_b3';
    const { ctx, origin } = await migratedThenChanged(
      dbName,
      { before: { psl: ADDRESS_WITH_ZIP }, after: { psl: ADDRESS_WITH_COUNTRY } },
      [{ email: 'a@example.com', home: { street: 'Main St', zip: '0150' }, addresses: [] }],
      'B3',
    );
    const from = ['--name', 'country', '--from', origin];

    const asked = engineError(await runMigrationPlan(ctx, [...from, '--json']));
    expect({
      code: asked?.code,
      why: asked?.why,
      answers: asked?.nextActions?.map(({ label }) => label),
    }).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      why: [
        'The plan would run:',
        '- Remove key "zip" at path "$" in field home of collection users',
        '- Remove key "zip" at path "$[*]" in field addresses of collection users',
        'If the values go, the existing objects get a temporary value in the new required field "Address.country".',
      ].join('\n'),
      answers: [
        'If the value object field was renamed to "country", keep its values: --rename Address.zip:Address.country',
        'If the values can go: --delete Address.zip',
      ],
    });
    expect(latestMigrationDirName(ctx), 'B3.05: nothing written').toBe(origin);

    const renamed = await runMigrationPlan(ctx, [
      ...from,
      '--rename',
      'Address.zip:Address.country',
      '--json',
    ]);
    expect(renamed.exitCode, `B3.06: plan --rename: ${renamed.stderr}`).toBe(0);
    const renameDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const renameTs = readFileSync(join(renameDir, 'migration.ts'), 'utf-8');
    expect(
      { renames: renameTs.includes('renameStoredKey('), fills: fillCalls(renameTs) },
      'B3.06: the rename and no fill',
    ).toEqual({ renames: true, fills: [] });
    rmSync(renameDir, { recursive: true });

    const planned = await runMigrationPlan(ctx, [
      ...from,
      '--delete',
      'Address.zip',
      '--backfill',
      'Address.country',
      '--json',
    ]);
    expect(planned.exitCode, `B3.07: plan --delete --backfill: ${planned.stderr}`).toBe(0);
    await filledAndApplied(ctx, 'Address.country:value', "{ $literal: 'NO' }", 'B3.08');
    expect(await documents(dbName)).toEqual([
      { email: 'a@example.com', home: { street: 'Main St', country: 'NO' }, addresses: [] },
    ]);
    await settledByMigrationPlan(ctx, dbName, 'B3.09');

    await emit(ctx, { psl: ADDRESS_WITH_SEEN }, 'B3.10');
    const seen = engineError(
      await runMigrationPlan(ctx, [
        '--name',
        'seen',
        '--from',
        latestMigrationDirName(ctx),
        '--json',
      ]),
    );
    expect(seen, 'B3.11: a field with no temporary value still needs --backfill').toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Removing value object field "Address.country" would delete its values.',
      why: [
        'The plan would run:',
        '- Remove key "country" at path "$" in field home of collection users',
        '- Remove key "country" at path "$[*]" in field addresses of collection users',
        'If the values go, the new required field "Address.seen" still needs a value: add --backfill Address.seen to write it in migration.ts.',
      ].join('\n'),
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'If the value object field was renamed to "seen", keep its values: --rename Address.country:Address.seen',
        },
        { kind: 'user-choice', label: 'If the values can go: --delete Address.country' },
      ],
      meta: {
        subject: 'Address.country',
        verbs: ['rename', 'delete'],
        unanswered: [{ subject: 'Address.country', verbs: ['rename', 'delete'] }],
      },
      docsUrl: 'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
    });
  });

  it('B4: a required field new in an embedded model takes --backfill with migration plan and a temporary value with db update', async () => {
    const contracts = {
      before: { typescriptFixture: 'contract-lines-sku.ts' },
      after: { typescriptFixture: 'contract-lines-sku-code.ts' },
    };
    const rows: readonly Document[] = [
      { email: 'a@example.com', lines: [{ sku: 'A-1' }, { sku: 'B-2', code: null }] },
      { email: 'b@example.com', lines: [] },
    ];

    const { ctx, origin } = await migratedThenChanged('mongo_vo_b4_plan', contracts, rows, 'B4');
    const planned = await runMigrationPlan(ctx, [
      '--name',
      'code',
      '--from',
      origin,
      '--backfill',
      'Line.code',
      '--json',
    ]);
    expect(planned.exitCode, `B4.05: migration plan: ${planned.stdout}\n${planned.stderr}`).toBe(0);
    const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    expect(fillCalls(readFileSync(join(dir, 'migration.ts'), 'utf-8'))).toEqual([
      "fillStoredKey({collection:'users',field:'lines',path:'$[*].code',value:placeholder('Line.code:value')})",
    ]);
    await filledAndApplied(ctx, 'Line.code:value', "{ $literal: 'X' }", 'B4.06');
    expect(await documents('mongo_vo_b4_plan')).toEqual([
      {
        email: 'a@example.com',
        lines: [
          { sku: 'A-1', code: 'X' },
          { sku: 'B-2', code: 'X' },
        ],
      },
      { email: 'b@example.com', lines: [] },
    ]);
    await settledByMigrationPlan(ctx, 'mongo_vo_b4_plan', 'B4.07');

    const updateCtx = setup('mongo_vo_b4_update', contracts.before);
    await emit(updateCtx, contracts.before, 'B4.11');
    expect((await runDbUpdate(updateCtx, ['--no-interactive'])).exitCode, 'B4.12').toBe(0);
    await seed('mongo_vo_b4_update', rows);
    await emit(updateCtx, contracts.after, 'B4.13');
    const updated = await runDbUpdate(updateCtx, ['--no-interactive', '--json']);
    expect(updated.exitCode, `B4.14: db update: ${updated.stdout}\n${updated.stderr}`).toBe(0);
    expect({
      reported: parseJsonOutput<{ temporaryValues: readonly unknown[] }>(updated).temporaryValues,
      documents: await documents('mongo_vo_b4_update'),
    }).toEqual({
      reported: [{ field: 'Line.code', value: '""' }],
      documents: [
        {
          email: 'a@example.com',
          lines: [
            { sku: 'A-1', code: '' },
            { sku: 'B-2', code: '' },
          ],
        },
        { email: 'b@example.com', lines: [] },
      ],
    });
    await verifiedAndSettled(updateCtx, 'mongo_vo_b4_update', 'B4.15', async () => {
      const further = await runDbUpdate(updateCtx, ['--dry-run', '--no-interactive', '--json']);
      return parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(further).plan.operations;
    });
  });
});
