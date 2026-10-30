/**
 * Journey: a SQLite schema written with the convenience date and time types, run with no global `Temporal`. `contract emit`, `db init` and `db verify` run as child processes with no `Temporal` and read every default, the Temporal types' included, through the fallback the SQLite target's control entry sets. An application with no `Temporal` then writes and reads the default types: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read strings. The client generates `now()` values for them in that process, and no process gains a global `Temporal`. Reading a Temporal type in that application raises `RUNTIME.TEMPORAL_UNAVAILABLE`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';
import {
  type ChildRun,
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from '../utils/node-without-temporal';

const BIN_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs',
);

const SCHEMA = `// use prisma-8

model Event {
  id         Int                    @id
  at         DateTime
  textAt     DateTime(as: string)
  day        Date
  opensAt    Time
  lasts      Duration
  createdDay Date                   @onCreate(now())
  clock      Time                   @onCreate(now())
  updatedAt  DateTime               @onCreate(now()) @onUpdate(now())
  dbDay      Date                   @default(now())
  dbClock    Time                   @default(now())
  settledAt  DateTime(as: temporal)?

  @@map("event")
}

model Schedule {
  id       Int                    @id
  exactAt  DateTime(as: temporal) @default(datetime\`2024-01-01T05:30:00+05:30\`)
  dayT     Date(as: temporal)     @default(date\`2024-02-29\`)
  opensAtT Time(as: temporal)     @default(time\`09:30\`)

  @@map("schedule")
}
`;

const APP_SCRIPT = `
import { readFileSync } from 'node:fs';

const { default: sqlite } = await import('@internal/sqlite/runtime');
const { contractFromJson } = await import('@internal/sqlite/static');
const db = sqlite({
  contract: contractFromJson(JSON.parse(readFileSync('contract.json', 'utf8'))),
  path: process.env.JOURNEY_DB_PATH,
});
const described = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([name, value]) => [
      name,
      value instanceof Date
        ? { kind: 'Date', value: value.toISOString() }
        : { kind: value === null ? 'null' : typeof value, value },
    ]),
  );
try {
  const events = db.orm.Event;
  await events.create({
    id: 1,
    at: new Date('2024-02-29T10:00:00.123Z'),
    textAt: '2024-02-29T15:30:00+05:30',
    day: '2024-02-29',
    opensAt: '09:30',
    lasts: 'PT1H30M',
    settledAt: null,
  });
  const read = await events
    .select('at', 'textAt', 'day', 'opensAt', 'lasts', 'createdDay', 'clock', 'updatedAt', 'dbDay', 'dbClock')
    .where({ id: 1 })
    .first();
  let temporalRead;
  try {
    await db.orm.Schedule.create({ id: 1 });
    temporalRead = 'read';
  } catch (error) {
    temporalRead = error.code;
  }
  process.stdout.write(JSON.stringify({ row: described(read), temporalRead }));
} finally {
  await db.close();
}
`;

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), SCHEMA, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function runBin(ctx: SqliteJourney, argv: readonly string[]): Promise<ChildRun> {
  return runNodeWithoutTemporal([BIN_PATH, ...argv], { cwd: ctx.testDir });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

withTempDir(({ createTempDir }) => {
  describe('Journey: the SQLite convenience date and time types in processes with no Temporal', () => {
    it(
      'emit, create and verify every default, and an application reads the default types',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);

        const emit = await runBin(ctx, ['contract', 'emit']);
        expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
        const columns = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'))
          .storage.namespaces.__unbound__.entries.table.schedule.columns;
        expect({
          exactAt: columns.exactAt.default,
          dayT: columns.dayT.default,
          opensAtT: columns.opensAtT.default,
        }).toEqual({
          exactAt: { kind: 'literal', value: '2024-01-01T00:00:00.000Z' },
          dayT: { kind: 'literal', value: '2024-02-29' },
          opensAtT: { kind: 'literal', value: '09:30:00.000' },
        });

        const init = await runBin(ctx, ['db', 'init']);
        expect(init, childOutput(init)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
        const verify = await runBin(ctx, ['db', 'verify', '--schema-only', '--strict', '--json']);
        expect(verify, childOutput(verify)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

        const script = join(ctx.testDir, 'app.mjs');
        writeFileSync(script, APP_SCRIPT, 'utf-8');
        const before = Date.now();
        const run = await runNodeWithoutTemporal([script], {
          cwd: ctx.testDir,
          env: { JOURNEY_DB_PATH: ctx.dbPath },
        });
        const after = Date.now();
        expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

        const { row, temporalRead } = JSON.parse(run.stdout);
        expect({ row, temporalRead }).toEqual({
          row: {
            at: { kind: 'Date', value: '2024-02-29T10:00:00.123Z' },
            textAt: { kind: 'string', value: '2024-02-29T10:00:00.000Z' },
            day: { kind: 'string', value: '2024-02-29' },
            opensAt: { kind: 'string', value: '09:30:00.000' },
            lasts: { kind: 'string', value: 'PT1H30M' },
            createdDay: { kind: 'string', value: expect.stringMatching(ISO_DATE) },
            clock: { kind: 'string', value: expect.stringMatching(ISO_TIME) },
            updatedAt: { kind: 'Date', value: expect.any(String) },
            dbDay: { kind: 'string', value: expect.stringMatching(ISO_DATE) },
            dbClock: { kind: 'string', value: expect.stringMatching(ISO_TIME) },
          },
          temporalRead: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        });
        const updatedAt = new Date(row.updatedAt.value).getTime();
        expect(updatedAt).toBeGreaterThanOrEqual(before);
        expect(updatedAt).toBeLessThanOrEqual(after);
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
