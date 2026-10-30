/**
 * Journey: a SQLite schema written with the convenience date and time types `DateTime`, `Date`, `Time` and `Duration`, with every `as:` choice, emits each field as the explicit type it chooses, migrates, and is written and read by the ORM. Each column holds the text its data type stores, in one form for each value. The client generates `now()` values for `@onCreate`, the database fills `@default(now())` for an instant, a date and a time of day, and `db verify` reads those defaults back as `now()`. A later migration adds required date and time columns to a table with a row, which takes each type's temporary value. A bare `DateTime` emits the contract it emitted before the convenience types.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const SCHEMA = `// use prisma-8

model Event {
  id           Int                    @id
  at           DateTime
  exactAt      DateTime(as: temporal)
  textAt       DateTime(as: string)
  day          Date
  dayT         Date(as: temporal)
  opensAt      Time
  opensAtT     Time(as: temporal)
  lasts        Duration
  createdAt    DateTime(as: temporal) @onCreate(now())
  createdDay   Date                   @onCreate(now())
  createdClock Time                   @onCreate(now())
  dbAt         DateTime               @default(now())
  dbDay        Date                   @default(now())
  dbClock      Time                   @default(now())
  fixedDay     Date                   @default(date\`2024-02-29\`)
  fixedClock   Time                   @default(time\`09:30\`)
  fixedSpan    Duration               @default(duration\`PT1H30M\`)

  @@map("event")
}
`;

const WITH_REQUIRED_COLUMNS = SCHEMA.replace(
  '\n  @@map("event")',
  `  due          Date
  alarm        Time
  span         Duration
  stamp        DateTime(as: string)

  @@map("event")`,
);

const COLUMN_CODECS = {
  at: 'sqlite/datetime@1',
  exactAt: 'sqlite/datetime-temporal@1',
  textAt: 'sqlite/datetime-string@1',
  day: 'sqlite/date-string@1',
  dayT: 'sqlite/date-temporal@1',
  opensAt: 'sqlite/time-string@1',
  opensAtT: 'sqlite/time-temporal@1',
  lasts: 'sqlite/duration-string@1',
  createdAt: 'sqlite/datetime-temporal@1',
  createdDay: 'sqlite/date-string@1',
  createdClock: 'sqlite/time-string@1',
  dbAt: 'sqlite/datetime@1',
  dbDay: 'sqlite/date-string@1',
  dbClock: 'sqlite/time-string@1',
};

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function output(run: { stdout: string; stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

async function emitContract(ctx: SqliteJourney, psl: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
}

async function planAndMigrate(ctx: SqliteJourney, name: string, origin?: string): Promise<void> {
  const plan = await planMigrationAndSelfEmit(ctx, [
    '--name',
    name,
    ...(origin === undefined ? [] : ['--from', origin]),
  ]);
  expect(plan.exitCode, `migration plan ${name}\n${output(plan)}`).toBe(0);
  const migrate = await runMigrate(ctx);
  expect(migrate.exitCode, `db migrate ${name}\n${output(migrate)}`).toBe(0);
}

function emittedCodecs(ctx: SqliteJourney): Record<string, string | undefined> {
  const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
  const columns = contract.storage.namespaces.__unbound__.entries.table.event.columns;
  return Object.fromEntries(
    Object.keys(COLUMN_CODECS).map((name) => [name, columns[name]?.codecId]),
  );
}

function storedRow(dbPath: string): Record<string, unknown> {
  const db = new DatabaseSync(dbPath);
  try {
    return { ...db.prepare('SELECT * FROM "event" WHERE "id" = 1').get() };
  } finally {
    db.close();
  }
}

function client(ctx: SqliteJourney) {
  return sqlite({
    contract: contractFromJson(
      JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')),
    ),
    path: ctx.dbPath,
  });
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

withTempDir(({ createTempDir }) => {
  describe('Journey: the SQLite convenience date and time types', () => {
    it(
      'emit as the explicit type each chooses, store their text, and read back their values',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, SCHEMA);
        expect(emittedCodecs(ctx)).toEqual(COLUMN_CODECS);
        await planAndMigrate(ctx, 'initial');

        const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
        expect(
          parseJsonOutput<{ schema: { issues: readonly unknown[] } }>(verify).schema.issues,
        ).toEqual([]);

        const db = client(ctx);
        const before = Date.now();
        try {
          await db.connect();
          const events = db.orm['Event'];
          if (events === undefined) return expect.unreachable('the contract has an Event model');
          await events.create({
            id: 1,
            at: new Date('2024-02-29T10:00:00.123Z'),
            exactAt: Temporal.Instant.from('2024-02-29T15:30:00.5+05:30'),
            textAt: '2024-02-29T10:00:00Z',
            day: '2024-02-29',
            dayT: Temporal.PlainDate.from('2024-03-01'),
            opensAt: '09:30',
            opensAtT: Temporal.PlainTime.from('17:45:00.25'),
            lasts: 'P1DT12H',
          });
          const read = await events
            .select(
              'at',
              'exactAt',
              'textAt',
              'day',
              'dayT',
              'opensAt',
              'opensAtT',
              'lasts',
              'createdAt',
              'createdDay',
              'createdClock',
              'fixedDay',
              'fixedClock',
              'fixedSpan',
            )
            .where({ id: 1 })
            .first();
          const after = Date.now();
          expect(read).toEqual({
            at: new Date('2024-02-29T10:00:00.123Z'),
            exactAt: expect.any(Temporal.Instant),
            textAt: '2024-02-29T10:00:00.000Z',
            day: '2024-02-29',
            dayT: expect.any(Temporal.PlainDate),
            opensAt: '09:30:00.000',
            opensAtT: expect.any(Temporal.PlainTime),
            lasts: 'P1DT12H',
            createdAt: expect.any(Temporal.Instant),
            createdDay: expect.stringMatching(ISO_DATE),
            createdClock: expect.stringMatching(ISO_TIME),
            fixedDay: '2024-02-29',
            fixedClock: '09:30:00.000',
            fixedSpan: 'PT1H30M',
          });
          expect({
            exactAt: String(read?.['exactAt']),
            dayT: String(read?.['dayT']),
            opensAtT: String(read?.['opensAtT']),
          }).toEqual({
            exactAt: '2024-02-29T10:00:00.5Z',
            dayT: '2024-03-01',
            opensAtT: '17:45:00.25',
          });
          const createdAt = Number(Reflect.get(Object(read?.['createdAt']), 'epochMilliseconds'));
          expect(createdAt).toBeGreaterThanOrEqual(before);
          expect(createdAt).toBeLessThanOrEqual(after);
        } finally {
          await db.close();
        }

        expect(storedRow(ctx.dbPath)).toEqual({
          id: 1,
          at: '2024-02-29T10:00:00.123Z',
          exactAt: '2024-02-29T10:00:00.500Z',
          textAt: '2024-02-29T10:00:00.000Z',
          day: '2024-02-29',
          dayT: '2024-03-01',
          opensAt: '09:30:00.000',
          opensAtT: '17:45:00.250',
          lasts: 'P1DT12H',
          createdAt: expect.stringMatching(ISO_INSTANT),
          createdDay: expect.stringMatching(ISO_DATE),
          createdClock: expect.stringMatching(ISO_TIME),
          dbAt: expect.stringMatching(ISO_INSTANT),
          dbDay: expect.stringMatching(ISO_DATE),
          dbClock: expect.stringMatching(ISO_TIME),
          fixedDay: '2024-02-29',
          fixedClock: '09:30:00.000',
          fixedSpan: 'PT1H30M',
        });

        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, WITH_REQUIRED_COLUMNS);
        await planAndMigrate(ctx, 'required-columns', origin);
        const migrated = storedRow(ctx.dbPath);
        expect({
          due: migrated['due'],
          alarm: migrated['alarm'],
          span: migrated['span'],
          stamp: migrated['stamp'],
        }).toEqual({
          due: '1970-01-01',
          alarm: '00:00:00.000',
          span: 'PT0S',
          stamp: '1970-01-01T00:00:00.000Z',
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'emits a bare DateTime exactly as it emitted before the convenience types',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        const fixtures = join(
          import.meta.dirname,
          '../convenience-date-time-types/fixtures/sqlite-bare-datetime',
        );
        await emitContract(ctx, readFileSync(join(fixtures, 'contract.prisma'), 'utf-8'));
        expect(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')).toBe(
          readFileSync(join(fixtures, 'emitted-before-convenience-types/contract.json'), 'utf-8'),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
