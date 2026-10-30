/**
 * Value object field and enum value statements on SQLite, on rows that hold the value objects.
 *
 * The SQLite twin of `value-object-statements.e2e.test.ts`. `Site.location` holds a `GeoPoint`, `Site.history` a list of them, and `Site.place` a `Place`, whose `point` is a `GeoPoint`, each in a JSON text column. A `GeoPoint` has `lat`, `lng` and an optional `status` typed by the enum `Status`.
 *
 * - O1: `GeoPoint.lat` is renamed to `latitude`. Without a statement the change is refused, offering `--rename GeoPoint.lat:GeoPoint.latitude`; with it, the key is renamed in the column, in every element of the list and in the nested object.
 * - O2: `GeoPoint.lng` is removed. Without a statement the change is refused, offering `--delete GeoPoint.lng`; with it, the key is removed everywhere.
 * - O3: `Status.ARCHIVED` is renamed to `RETIRED`, which stores `retired`, and `Status.DRAFT` is removed. Without statements the change is refused; with `--rename Status.ARCHIVED:Status.RETIRED` and `--delete Status.DRAFT`, `archived` becomes `retired` and `draft` becomes `null`, at every path.
 *
 * Every journey runs twice: through `migration plan` and `migrate`, whose `migration.ts` is run again and reproduces its `ops.json`, and through `db update`. Each reads the rows back and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

type Via = 'migrate' | 'db update';
const VIAS: readonly Via[] = ['migrate', 'db update'];

function siteContract(input: {
  readonly geoPoint: string;
  readonly statusMembers: string;
}): string {
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
  ACTIVE = "active"
${input.statusMembers}}

type GeoPoint {
${input.geoPoint}  status Status?
}

type Place {
  name  String
  point GeoPoint
}

model Site {
  id       Int        @id
  location GeoPoint?
  history  GeoPoint[]
  place    Place?
  @@map("site")
}
`;
}

const STATUS = '  ARCHIVED = "archived"\n  DRAFT = "draft"\n';
const GEO = '  lat Float\n  lng Float\n';
const FROM = siteContract({ geoPoint: GEO, statusMembers: STATUS });
const LAT_RENAMED = siteContract({
  geoPoint: '  latitude Float\n  lng Float\n',
  statusMembers: STATUS,
});
const LNG_REMOVED = siteContract({ geoPoint: '  lat Float\n', statusMembers: STATUS });
const STATUS_CHANGED = siteContract({ geoPoint: GEO, statusMembers: '  RETIRED = "retired"\n' });

const SEED = `INSERT INTO "site" (id, location, history, place) VALUES
  (1, '{"lat": 1, "lng": 2, "status": "archived"}',
      '[{"lat": 3, "lng": 4, "status": "draft"}, {"lat": 5, "lng": 6, "status": null}]',
      '{"name": "Home", "point": {"lat": 7, "lng": 8, "status": "active"}}'),
  (2, NULL, '[]', NULL)`;

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function journey(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function withDatabase<T>(dbPath: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function fromLatest(ctx: JourneyContext): readonly string[] {
  return getMigrationDirs(ctx).length === 0 ? [] : ['--from', latestMigrationDirName(ctx)];
}

/** Applies the emitted contract through `via`, with the statements given, and checks a written `migration.ts` reproduces its `ops.json`. */
async function apply(
  ctx: JourneyContext,
  via: Via,
  statements: readonly string[],
  label: string,
): Promise<void> {
  if (via === 'db update') {
    const update = await runDbUpdate(ctx, [...statements, '--no-interactive', '--json']);
    expect(update.exitCode, `${label}: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
    return;
  }
  const plan = await runMigrationPlan(ctx, [
    ...fromLatest(ctx),
    '--name',
    label.replace(/\W/g, '-'),
    ...statements,
    '--json',
  ]);
  expect(plan.exitCode, `${label}: plan: ${plan.stderr}`).toBe(0);
  const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
  const ops = readFileSync(join(dir, 'ops.json'), 'utf-8');
  const reEmit = await selfEmitMigration(ctx, ['--dir', dir]);
  expect(reEmit.exitCode, `${label}: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
  expect(readFileSync(join(dir, 'ops.json'), 'utf-8'), `${label}: same ops.json`).toBe(ops);
  const migrate = await runMigrate(ctx, ['--json']);
  expect(migrate.exitCode, `${label}: migrate: ${JSON.stringify(engineError(migrate))}`).toBe(0);
}

/** The text of the refusal of the emitted contract without statements. */
async function refusal(ctx: JourneyContext, via: Via, label: string): Promise<string> {
  const refused =
    via === 'db update'
      ? await runDbUpdate(ctx, ['--no-interactive', '--json'])
      : await runMigrationPlan(ctx, [...fromLatest(ctx), '--name', 'refused', '--json']);
  expect(refused.exitCode, `${label}: refused without a statement`).not.toBe(0);
  return JSON.stringify(engineError(refused));
}

async function expectSettled(ctx: JourneyContext, via: Via, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate') {
    const fresh = await runMigrationPlan(ctx, [...fromLatest(ctx), '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function sites(dbPath: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare('SELECT id, location, history, place FROM "site" ORDER BY id')
      .all()
      .map((row) => ({
        id: row['id'],
        location: parsed(row['location']),
        history: parsed(row['history']),
        place: parsed(row['place']),
      })),
  );
}

/** Creates the tables with `FROM`, seeds the rows and emits `to`. */
async function seededThen(ctx: SqliteJourney, via: Via, to: string, label: string): Promise<void> {
  await emit(ctx, FROM, `${label}.01`);
  await apply(ctx, via, [], `${label}.02`);
  withDatabase(ctx.dbPath, (db) => db.exec(SEED));
  await emit(ctx, to, `${label}.03`);
}

withTempDir(({ createTempDir }) => {
  describe.each(VIAS)('O1 (SQLite, %s): rename a value object field', (via) => {
    it(
      'is refused offering the rename, and --rename GeoPoint.lat:GeoPoint.latitude renames the key at every path',
      async () => {
        const ctx = journey(createTempDir);
        await seededThen(ctx, via, LAT_RENAMED, 'O1');

        const asked = await refusal(ctx, via, 'O1.04');
        expect(asked, 'O1.04: one question, the rename offered').toContain(
          '\\"GeoPoint.lat\\" needs a statement',
        );
        expect(asked, 'O1.04: the rename offered').toContain(
          '--rename GeoPoint.lat:GeoPoint.latitude',
        );
        expect(asked, 'O1.04: what --delete leaves in the new field').toContain(
          via === 'db update'
            ? 'the existing objects get a temporary value in the new required field \\"GeoPoint.latitude\\"'
            : 'the new required field \\"GeoPoint.latitude\\" gets a placeholder value in migration.ts',
        );
        await apply(ctx, via, ['--rename', 'GeoPoint.lat:GeoPoint.latitude'], 'O1.05');

        expect(sites(ctx.dbPath), 'O1.05: the key is renamed everywhere').toEqual([
          {
            id: 1,
            location: { latitude: 1, lng: 2, status: 'archived' },
            history: [
              { latitude: 3, lng: 4, status: 'draft' },
              { latitude: 5, lng: 6, status: null },
            ],
            place: { name: 'Home', point: { latitude: 7, lng: 8, status: 'active' } },
          },
          { id: 2, location: null, history: [], place: null },
        ]);
        await expectSettled(ctx, via, 'O1.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('O2 (SQLite, %s): remove a value object field', (via) => {
    it(
      'is refused offering the delete, and --delete GeoPoint.lng removes the key at every path',
      async () => {
        const ctx = journey(createTempDir);
        await seededThen(ctx, via, LNG_REMOVED, 'O2');

        expect(await refusal(ctx, via, 'O2.04'), 'O2.04: the delete offered').toContain(
          '--delete GeoPoint.lng',
        );
        await apply(ctx, via, ['--delete', 'GeoPoint.lng'], 'O2.05');

        expect(sites(ctx.dbPath), 'O2.05: the key is removed everywhere').toEqual([
          {
            id: 1,
            location: { lat: 1, status: 'archived' },
            history: [
              { lat: 3, status: 'draft' },
              { lat: 5, status: null },
            ],
            place: { name: 'Home', point: { lat: 7, status: 'active' } },
          },
          { id: 2, location: null, history: [], place: null },
        ]);
        await expectSettled(ctx, via, 'O2.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)(
    'O3 (SQLite, %s): rename and remove enum values inside a value object',
    (via) => {
      it(
        'is refused offering the statements, and the statements rewrite the values at every path',
        async () => {
          const ctx = journey(createTempDir);
          await seededThen(ctx, via, STATUS_CHANGED, 'O3');

          const offered = await refusal(ctx, via, 'O3.04');
          expect(offered, 'O3.04: the rename offered').toContain(
            '--rename Status.ARCHIVED:Status.RETIRED',
          );
          expect(offered, 'O3.04: the delete offered').toContain('--delete Status.DRAFT');
          await apply(
            ctx,
            via,
            ['--rename', 'Status.ARCHIVED:Status.RETIRED', '--delete', 'Status.DRAFT'],
            'O3.05',
          );

          expect(sites(ctx.dbPath), 'O3.05: the values are rewritten').toEqual([
            {
              id: 1,
              location: { lat: 1, lng: 2, status: 'retired' },
              history: [
                { lat: 3, lng: 4, status: null },
                { lat: 5, lng: 6, status: null },
              ],
              place: { name: 'Home', point: { lat: 7, lng: 8, status: 'active' } },
            },
            { id: 2, location: null, history: [], place: null },
          ]);
          await expectSettled(ctx, via, 'O3.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
});
