/**
 * Journey: a MySQL schema written with the convenience date and time types, run with no global `Temporal`. `contract emit`, `db init` and `db verify` run as child processes with no `Temporal` and read every default, the Temporal types' included, through the fallback the MySQL target's control entry sets. An application with no `Temporal` then writes the default types through the raw SQL lane, since the ORM cannot write to MySQL yet, and reads them through the ORM: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read strings. No process gains a global `Temporal`. Reading a Temporal type in that application raises `RUNTIME.TEMPORAL_UNAVAILABLE`. Skipped when `MYSQL_URL` is not set.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  mysqlPslConfigFixture,
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
  id      Int                  @id
  at      DateTime
  textAt  DateTime(as: string)
  day     Date
  opensAt Time
  lasts   Duration
  dbAt    DateTime             @default(now())
  dbDay   Date                 @default(now())
  dbClock Time                 @default(now())

  @@map("event")
}

model Schedule {
  id       Int                    @id
  exactAt  DateTime(as: temporal) @default(datetime\`2024-01-01T00:00:00\`)
  dayT     Date(as: temporal)     @default(date\`2024-02-29\`)
  opensAtT Time(as: temporal)     @default(time\`09:30\`)

  @@map("schedule")
}
`;

const APP_SCRIPT = `
import { readFileSync } from 'node:fs';

const { default: mysql } = await import('@internal/mysql/runtime');
const { contractFromJson } = await import('@internal/mysql/static');
const { ParamRef } = await import('@internal/sql-relational-core/ast');
const contractJson = JSON.parse(readFileSync('contract.json', 'utf8'));
const db = mysql({ contract: contractFromJson(contractJson), url: process.env.JOURNEY_DB_URL });
const columns = contractJson.storage.namespaces.__unbound__.entries.table.event.columns;
const value = (column, written) => {
  const { codecId, typeParams } = columns[column];
  return ParamRef.of(written, { codec: typeParams === undefined ? { codecId } : { codecId, typeParams } });
};
const described = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([name, read]) => [
      name,
      read instanceof Date
        ? { kind: 'Date', value: read.toISOString() }
        : { kind: read === null ? 'null' : typeof read, value: read },
    ]),
  );
try {
  await db.execute(
    db.raw.sql\`INSERT INTO event (id, at, textAt, day, opensAt, lasts) VALUES (
      \${1},
      \${value('at', new Date('2024-02-29T10:00:00.123Z'))},
      \${value('textAt', '2024-02-29T15:30:00+05:30')},
      \${value('day', '2024-02-29')},
      \${value('opensAt', '09:30')},
      \${value('lasts', 'PT1H30M')}
    )\`.affectedCount().build(),
  );
  const read = await db.orm.Event
    .select('at', 'textAt', 'day', 'opensAt', 'lasts', 'dbAt', 'dbDay', 'dbClock')
    .where({ id: 1 })
    .first();
  await db.execute(db.raw.sql\`INSERT INTO schedule (id) VALUES (\${1})\`.affectedCount().build());
  let temporalRead;
  try {
    await db.orm.Schedule.select('exactAt').where({ id: 1 }).first();
    temporalRead = 'read';
  } catch (error) {
    temporalRead = error.code;
  }
  process.stdout.write(JSON.stringify({ row: described(read), temporalRead }));
} finally {
  await db.close();
}
`;

function setup(createTempDir: () => string, url: string): JourneyContext {
  const testDir = createTempDir();
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(mysqlPslConfigFixture, 'utf-8').replace('{{DB_URL}}', () => url);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), SCHEMA, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir };
}

function runBin(ctx: JourneyContext, argv: readonly string[]): Promise<ChildRun> {
  return runNodeWithoutTemporal([BIN_PATH, ...argv], { cwd: ctx.testDir });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

withTempDir(({ createTempDir }) => {
  describe('Journey: the MySQL convenience date and time types in processes with no Temporal', () => {
    it(
      'emit, create and verify every default, and an application reads the default types',
      async (test) => {
        await withMysqlDatabase(test, async ({ url }) => {
          const ctx = setup(createTempDir, url);

          const emit = await runBin(ctx, ['contract', 'emit']);
          expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const columns = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'))
            .storage.namespaces.__unbound__.entries.table.schedule.columns;
          expect({
            exactAt: columns.exactAt.default,
            dayT: columns.dayT.default,
            opensAtT: columns.opensAtT.default,
          }).toEqual({
            exactAt: { kind: 'literal', value: '2024-01-01T00:00:00' },
            dayT: { kind: 'literal', value: '2024-02-29' },
            opensAtT: { kind: 'literal', value: '09:30:00' },
          });

          const init = await runBin(ctx, ['db', 'init']);
          expect(init, childOutput(init)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const verify = await runBin(ctx, ['db', 'verify', '--schema-only', '--strict', '--json']);
          expect(verify, childOutput(verify)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

          const script = join(ctx.testDir, 'app.mjs');
          writeFileSync(script, APP_SCRIPT, 'utf-8');
          const before = Date.now() - 1000;
          const run = await runNodeWithoutTemporal([script], {
            cwd: ctx.testDir,
            env: { JOURNEY_DB_URL: url },
          });
          const after = Date.now() + 1000;
          expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

          const { row, temporalRead } = JSON.parse(run.stdout);
          expect({ row, temporalRead }).toEqual({
            row: {
              at: { kind: 'Date', value: '2024-02-29T10:00:00.123Z' },
              textAt: { kind: 'string', value: '2024-02-29T10:00:00Z' },
              day: { kind: 'string', value: '2024-02-29' },
              opensAt: { kind: 'string', value: '09:30:00' },
              lasts: { kind: 'string', value: 'PT1H30M' },
              dbAt: { kind: 'Date', value: expect.any(String) },
              dbDay: { kind: 'string', value: expect.stringMatching(ISO_DATE) },
              dbClock: { kind: 'string', value: expect.stringMatching(ISO_TIME) },
            },
            temporalRead: 'RUNTIME.TEMPORAL_UNAVAILABLE',
          });
          const dbAt = new Date(row.dbAt.value).getTime();
          expect(dbAt).toBeGreaterThanOrEqual(before);
          expect(dbAt).toBeLessThanOrEqual(after);
        });
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
