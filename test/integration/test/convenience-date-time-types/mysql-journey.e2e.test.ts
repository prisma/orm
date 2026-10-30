/**
 * Journey: a MySQL schema written with the convenience date and time types `DateTime`, `Date`, `Time` and `Duration`, with every `as:` and `storage:` choice, emits each field as the explicit type it chooses, migrates, and `db verify` finds no difference, the `now()` defaults included. The ORM cannot write to MySQL yet, so each row is written through the raw SQL lane, with every value a parameter its column's codec encodes, and read back through the ORM. The database fills `@default(now())` for an instant, a date and a time of day. Changing a `DateTime @default(now())` field to `Date` is a change `db verify` reports and the planner names. A bare `DateTime` emits the contract `DatetimeJsDate(3)` emits, as `DateTime` did before the convenience types. Skipped when `MYSQL_URL` is not set.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import mysql from '@internal/mysql/runtime';
import { contractFromJson } from '@internal/mysql/static';
import { param } from '@internal/sql-relational-core/expression';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  mysqlPslConfigFixture,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  timeouts,
} from '../utils/journey-test-helpers';

const SCHEMA = `// use prisma-8

model Event {
  id        Int                                     @id
  at        DateTime
  exactAt   DateTime(as: temporal)
  textAt    DateTime(as: string)
  stamp     DateTime(storage: timestamp)
  stampT    DateTime(as: temporal, storage: timestamp)
  stampText DateTime(as: string, storage: timestamp, precision: 0)
  day       Date
  dayT      Date(as: temporal)
  opensAt   Time
  opensAtT  Time(as: temporal, precision: 3)
  lasts     Duration
  createdAt temporal.CreatedAt
  dbAt      DateTime                                @default(now())
  dbStamp   DateTime(as: string, storage: timestamp) @default(now())
  dbDay     Date                                    @default(now())
  dbClock   Time                                    @default(now())
  fixedDay  Date                                    @default(date\`2024-02-29\`)
  fixedTime Time                                    @default(time\`09:30\`)
  fixedSpan Duration                                @default(duration\`PT1H30M\`)

  @@map("event")
}
`;

const WITH_DB_AT_AS_DATE = SCHEMA.replace(
  'dbAt      DateTime                                @default(now())',
  'dbAt      Date                                    @default(now())',
);

const COLUMN_TYPES = {
  at: ['mysql/datetime@1', { precision: 3 }],
  exactAt: ['mysql/datetime-temporal@1', { precision: 6 }],
  textAt: ['mysql/datetime-string@1', { precision: 6 }],
  stamp: ['mysql/timestamp@1', { precision: 3 }],
  stampT: ['mysql/timestamp-temporal@1', { precision: 6 }],
  stampText: ['mysql/timestamp-string@1', { precision: 0 }],
  day: ['mysql/date-string@1', undefined],
  dayT: ['mysql/date-temporal@1', undefined],
  opensAt: ['mysql/time-string@1', { precision: 6 }],
  opensAtT: ['mysql/time-temporal@1', { precision: 3 }],
  lasts: ['mysql/duration-string@1', undefined],
  createdAt: ['mysql/datetime@1', { precision: 3 }],
};

/** Emitting reads no database, so the bare-DateTime check runs without MySQL. */
const UNCONNECTED_URL = 'mysql://root@127.0.0.1:1/unused';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

function setup(createTempDir: () => string, url: string): JourneyContext {
  const testDir = createTempDir();
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(mysqlPslConfigFixture, 'utf-8').replace('{{DB_URL}}', () => url);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir };
}

function output(run: { stdout: string; stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

async function emitContract(ctx: JourneyContext, psl: string): Promise<string> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
  return readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8');
}

function emittedTypes(contractJson: string): Record<string, unknown> {
  const columns = JSON.parse(contractJson).storage.namespaces.__unbound__.entries.table.event
    .columns as Record<string, { codecId: string; typeParams?: unknown }>;
  return Object.fromEntries(
    Object.keys(COLUMN_TYPES).map((name) => [
      name,
      [columns[name]?.codecId, columns[name]?.typeParams],
    ]),
  );
}

function client(ctx: JourneyContext, url: string) {
  return mysql({
    contract: contractFromJson(
      JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')),
    ),
    url,
  });
}

withTempDir(({ createTempDir }) => {
  describe('Journey: the MySQL convenience date and time types', () => {
    it(
      'emit as the explicit type each chooses, migrate, verify, and read back the values written',
      async (test) => {
        await withMysqlDatabase(test, async ({ url }) => {
          const ctx = setup(createTempDir, url);
          expect(emittedTypes(await emitContract(ctx, SCHEMA))).toEqual(COLUMN_TYPES);

          const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
          expect(plan.exitCode, `migration plan\n${output(plan)}`).toBe(0);
          const migrate = await runMigrate(ctx);
          expect(migrate.exitCode, `db migrate\n${output(migrate)}`).toBe(0);

          const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
          expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
          expect(
            parseJsonOutput<{ schema: { issues: readonly unknown[] } }>(verify).schema.issues,
          ).toEqual([]);

          const db = client(ctx, url);
          try {
            const before = Date.now() - 1000;
            await db.execute(
              db.raw
                .sql`INSERT INTO event (id, at, exactAt, textAt, stamp, stampT, stampText, day, dayT, opensAt, opensAtT, lasts, createdAt) VALUES (
                ${1},
                ${param(new Date('2024-02-29T10:00:00.123Z'), { codecId: 'mysql/datetime@1' })},
                ${param(Temporal.Instant.from('2024-02-29T15:30:00.123456+05:30'), { codecId: 'mysql/datetime-temporal@1' })},
                ${param('2024-02-29T10:00:00.5Z', { codecId: 'mysql/datetime-string@1' })},
                ${param(new Date('2024-02-29T10:00:00.250Z'), { codecId: 'mysql/timestamp@1' })},
                ${param(Temporal.Instant.from('2024-02-29T10:00:00.75Z'), { codecId: 'mysql/timestamp-temporal@1' })},
                ${param('2024-02-29T11:00:00+01:00', { codecId: 'mysql/timestamp-string@1' })},
                ${param('2024-02-29', { codecId: 'mysql/date-string@1' })},
                ${param(Temporal.PlainDate.from('2024-03-01'), { codecId: 'mysql/date-temporal@1' })},
                ${param('09:30', { codecId: 'mysql/time-string@1' })},
                ${param(Temporal.PlainTime.from('17:45:00.25'), { codecId: 'mysql/time-temporal@1' })},
                ${param('P1DT12H', { codecId: 'mysql/duration-string@1' })},
                ${param(new Date(before), { codecId: 'mysql/datetime@1' })}
              )`
                .affectedCount()
                .build(),
            );
            const events = db.orm['Event'];
            if (events === undefined) return expect.unreachable('the contract has an Event model');
            const read = await events
              .select(
                'at',
                'exactAt',
                'textAt',
                'stamp',
                'stampT',
                'stampText',
                'day',
                'dayT',
                'opensAt',
                'opensAtT',
                'lasts',
                'dbAt',
                'dbStamp',
                'dbDay',
                'dbClock',
                'fixedDay',
                'fixedTime',
                'fixedSpan',
              )
              .where({ id: 1 })
              .first();
            expect(read).toEqual({
              at: new Date('2024-02-29T10:00:00.123Z'),
              exactAt: expect.any(Temporal.Instant),
              textAt: '2024-02-29T10:00:00.5Z',
              stamp: new Date('2024-02-29T10:00:00.250Z'),
              stampT: expect.any(Temporal.Instant),
              stampText: '2024-02-29T10:00:00Z',
              day: '2024-02-29',
              dayT: expect.any(Temporal.PlainDate),
              opensAt: '09:30:00',
              opensAtT: expect.any(Temporal.PlainTime),
              lasts: 'P1DT12H',
              dbAt: expect.any(Date),
              dbStamp: expect.stringMatching(ISO_INSTANT),
              dbDay: expect.stringMatching(ISO_DATE),
              dbClock: expect.stringMatching(ISO_TIME),
              fixedDay: '2024-02-29',
              fixedTime: '09:30:00',
              fixedSpan: 'PT1H30M',
            });
            expect({
              exactAt: String(read?.['exactAt']),
              stampT: String(read?.['stampT']),
              dayT: String(read?.['dayT']),
              opensAtT: String(read?.['opensAtT']),
            }).toEqual({
              exactAt: '2024-02-29T10:00:00.123456Z',
              stampT: '2024-02-29T10:00:00.75Z',
              dayT: '2024-03-01',
              opensAtT: '17:45:00.25',
            });
            const dbAtValue = read?.['dbAt'];
            const dbAt = dbAtValue instanceof Date ? dbAtValue.getTime() : Number.NaN;
            expect(dbAt).toBeGreaterThanOrEqual(before);
            expect(dbAt).toBeLessThanOrEqual(Date.now() + 1000);
          } finally {
            await db.close();
          }

          const origin = latestMigrationDirName(ctx);
          await emitContract(ctx, WITH_DB_AT_AS_DATE);
          const drifted = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
          expect(
            drifted.exitCode,
            `db verify after DateTime became Date\n${output(drifted)}`,
          ).not.toBe(0);
          const changed = await runMigrationPlan(ctx, [
            '--name',
            'db-at-as-date',
            '--from',
            origin,
            '--json',
          ]);
          expect(changed.exitCode).not.toBe(0);
          expect(output(changed)).toContain(
            "Changing a column's type is not yet supported on MySQL (event.dbAt)",
          );
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'emits a bare DateTime exactly as DatetimeJsDate(3), the mysql/datetime@1 column DateTime named before the convenience types',
      async () => {
        const bare = readFileSync(
          join(import.meta.dirname, 'fixtures/mysql-bare-datetime/contract.prisma'),
          'utf-8',
        );
        const ctx = setup(createTempDir, UNCONNECTED_URL);
        const emittedBare = await emitContract(ctx, bare);
        const emittedExplicit = await emitContract(
          ctx,
          bare.replace(/\bDateTime\b/g, 'DatetimeJsDate(3)'),
        );

        expect(emittedBare).toBe(emittedExplicit);
        const columns = JSON.parse(emittedBare).storage.namespaces.__unbound__.entries.table.event
          .columns as Record<string, { codecId: string; typeParams: unknown }>;
        expect(
          Object.fromEntries(
            Object.entries(columns)
              .filter(([name]) => name !== 'id')
              .map(([name, { codecId, typeParams }]) => [name, { codecId, typeParams }]),
          ),
        ).toEqual(
          Object.fromEntries(
            ['at', 'maybe', 'createdAt', 'updatedAt'].map((name) => [
              name,
              { codecId: 'mysql/datetime@1', typeParams: { precision: 3 } },
            ]),
          ),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
