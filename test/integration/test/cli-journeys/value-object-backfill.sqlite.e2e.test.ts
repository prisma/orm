/**
 * A value object field that becomes required, on SQLite, with rows that hold the value object.
 *
 * The SQLite twin of `value-object-backfill.e2e.test.ts`. `User.address` holds an `Address` and `User.previous` a list of them, each in a JSON text column. Adding `country String` to `Address`:
 *
 * - B1: `migration plan` without a statement is refused, naming `--backfill Address.country`. With it, the plan writes one `fillStoredKey` per column and path whose value is `placeholder("Address.country:value")`, and `ops.json` stays empty. A value the field's data type refuses, such as `12`, fails `node migration.ts` with `CONTRACT.ARGUMENT_INVALID` before `ops.json` is written. Writing a string and running `node migration.ts` writes `ops.json`; `db migrate` fills every object, and a further plan is empty.
 * - B2: `db update` fills the field with a temporary value, `""`, and prints it with the `--backfill` statement that chooses the value. Adding `seen DateTime` next is refused, since `""` is no date, naming `migration plan --backfill Address.seen`.
 *
 * Each reads the rows back and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

function userContract(addressMembers: string): string {
  return `// use prisma-8

type Address {
${addressMembers}}

model User {
  id       Int       @id
  address  Address?
  previous Address[]
  @@map("user")
}
`;
}

const ADDRESS = userContract('  street String\n');
const ADDRESS_WITH_COUNTRY = userContract('  street  String\n  country String\n');
const ADDRESS_WITH_SEEN = userContract('  street  String\n  country String\n  seen    DateTime\n');

const ROWS = `INSERT INTO "user" (id, address, previous) VALUES
  (1, '{"street": "Main St"}', '[{"street": "Elm St"}, {"street": "Oak St"}]'),
  (2, NULL, '[]')`;

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

function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function users(dbPath: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare('SELECT id, address, previous FROM "user" ORDER BY id')
      .all()
      .map((row) => ({
        id: row['id'],
        address: parsed(row['address']),
        previous: parsed(row['previous']),
      })),
  );
}

async function expectNothingLeft(ctx: JourneyContext, label: string): Promise<void> {
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

withTempDir(({ createTempDir }) => {
  describe('B1 (SQLite): migration plan --backfill Address.country', () => {
    it(
      'is needed, writes a placeholder value, and fills every object once the value is written',
      async () => {
        const ctx = journey(createTempDir);
        await emit(ctx, ADDRESS, 'B1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `B1.02: plan: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'B1.02: migrate').toBe(0);
        withDatabase(ctx.dbPath, (db) => db.exec(ROWS));

        await emit(ctx, ADDRESS_WITH_COUNTRY, 'B1.03');
        const from = ['--name', 'country', '--from', latestMigrationDirName(ctx)];
        const refused = await runMigrationPlan(ctx, [...from, '--json']);
        expect(refused.exitCode, 'B1.04: refused without --backfill').not.toBe(0);
        expect(JSON.stringify(engineError(refused)), 'B1.04: names the statement').toContain(
          'Add --backfill Address.country',
        );

        const planned = await runMigrationPlan(ctx, [
          ...from,
          '--backfill',
          'Address.country',
          '--json',
        ]);
        expect(planned.exitCode, `B1.05: plan --backfill: ${planned.stderr}`).toBe(0);
        expect(parseJsonOutput<{ pendingPlaceholders?: boolean }>(planned)).toMatchObject({
          pendingPlaceholders: true,
        });
        expect(
          parseJsonOutput<{ operations: readonly { label: string }[] }>(planned).operations.map(
            ({ label }) => label,
          ),
          'B1.05: the plan lists the fills',
        ).toEqual(
          expect.arrayContaining([
            'Fill key "country" at path "$" in column "address" of "user"',
            'Fill key "country" at path "$[*]" in column "previous" of "user"',
          ]),
        );
        const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
        const written = readFileSync(join(dir, 'migration.ts'), 'utf-8');
        const fills = [
          ...written.matchAll(
            /this\.fillStoredKey\(\{\s*table: 'user',\s*column: '(\w+)',\s*path: '([^']+)',\s*value: placeholder\('Address\.country:value'\),\s*field: 'Address\.country',\s*\}\)/g,
          ),
        ].map(([, column, path]) => `${column} ${path}`);
        expect(fills, 'B1.05: a placeholder fill per column and path').toEqual([
          'address $.country',
          'previous $[*].country',
        ]);
        expect(JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')), 'B1.05: no ops').toEqual(
          [],
        );

        const unfilled = await runMigrate(ctx, ['--json']);
        expect(unfilled.exitCode, 'B1.05: db migrate refuses unfilled placeholders').not.toBe(0);
        expect(engineError(unfilled), 'B1.05: names the migration and the command').toMatchObject({
          code: 'MIGRATION.UNFILLED_PLACEHOLDER',
          why: expect.stringContaining(`migrations/app/${latestMigrationDirName(ctx)}`),
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              command: expect.stringContaining(
                `node migrations/app/${latestMigrationDirName(ctx)}/migration.ts`,
              ),
            }),
          ]),
        });

        writeFileSync(
          join(dir, 'migration.ts'),
          written.replaceAll("placeholder('Address.country:value')", '12'),
        );
        const refusedValue = await selfEmitMigration(ctx, [
          '--dir',
          dir,
          '--config',
          ctx.configPath,
        ]);
        expect(refusedValue.exitCode, 'B1.06: a number is refused for a String field').not.toBe(0);
        expect(
          `${refusedValue.stdout}${refusedValue.stderr}`.split(
            'value 12 for field "Address.country" is not a String',
          ).length,
          'B1.06: names the field and its type, once',
        ).toBe(2);
        expect(
          JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')),
          'B1.06: still no ops',
        ).toEqual([]);

        const filled = written.replaceAll("placeholder('Address.country:value')", "'NO'");
        expect(filled, 'B1.06: no placeholder left').not.toContain('placeholder(');
        writeFileSync(join(dir, 'migration.ts'), filled);
        const emitted = await selfEmitMigration(ctx, ['--dir', dir, '--config', ctx.configPath]);
        expect(
          emitted.exitCode,
          `B1.06: node migration.ts: ${emitted.stdout}${emitted.stderr}`,
        ).toBe(0);
        const migrate = await runMigrate(ctx, ['--json']);
        expect(migrate.exitCode, `B1.07: migrate: ${JSON.stringify(engineError(migrate))}`).toBe(0);

        expect(users(ctx.dbPath), 'B1.07: every object is filled').toEqual([
          {
            id: 1,
            address: { street: 'Main St', country: 'NO' },
            previous: [
              { street: 'Elm St', country: 'NO' },
              { street: 'Oak St', country: 'NO' },
            ],
          },
          { id: 2, address: null, previous: [] },
        ]);
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `B1.08: db verify: ${verify.stderr}`).toBe(0);
        const again = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(again.exitCode, `B1.08: plan again: ${again.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(again).noOp, 'B1.08: nothing to plan').toBe(true);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('B2 (SQLite): db update', () => {
    it(
      'fills a temporary value and names the --backfill statement that chooses it',
      async () => {
        const ctx = journey(createTempDir);
        await emit(ctx, ADDRESS, 'B2.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'B2.02: db update').toBe(0);
        withDatabase(ctx.dbPath, (db) => db.exec(ROWS));

        await emit(ctx, ADDRESS_WITH_COUNTRY, 'B2.03');
        const human = await runDbUpdate(ctx, ['--dry-run']);
        expect(human.exitCode, `B2.04: db update --dry-run: ${human.stderr}`).toBe(0);
        expect(
          `${human.stdout}${human.stderr}`,
          'B2.04: names the value and the statement',
        ).toMatch(
          /Existing rows would get "" in field "Address\.country"\. To choose the value, plan a migration with .*--backfill Address\.country instead\./s,
        );
        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode, `B2.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
        expect(
          parseJsonOutput<{ temporaryValues: readonly unknown[] }>(update).temporaryValues,
          'B2.05: one temporary value per field',
        ).toEqual([{ field: 'Address.country', value: '""' }]);
        expect(users(ctx.dbPath), 'B2.05: every object is filled').toEqual([
          {
            id: 1,
            address: { street: 'Main St', country: '' },
            previous: [
              { street: 'Elm St', country: '' },
              { street: 'Oak St', country: '' },
            ],
          },
          { id: 2, address: null, previous: [] },
        ]);
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `B2.06: db verify: ${verify.stderr}`).toBe(0);
        await expectNothingLeft(ctx, 'B2.07');

        await emit(ctx, ADDRESS_WITH_SEEN, 'B2.08');
        const refused = await runDbUpdate(ctx, ['--json']);
        expect(refused.exitCode, 'B2.09: a DateTime field is refused').not.toBe(0);
        expect(
          JSON.stringify(engineError(refused)),
          'B2.09: names migration plan --backfill',
        ).toContain('prisma migration plan --backfill Address.seen');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
