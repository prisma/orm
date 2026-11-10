/**
 * An application with no global `Temporal` writes and reads the date and time columns of a
 * database Prisma 7 created, through a contract from `contract infer` and through one from
 * `prisma7Schema(...)`.
 *
 * The application runs as a child process that loads only the runtime entry of
 * `@prisma/orm-postgres`. The fallback `Temporal` the Postgres control entry sets comes from
 * `temporal-polyfill`, and the child checks that it never loads that package, so nothing stands in
 * for the missing global. It runs in a time zone other than UTC, so a timestamp written in the
 * host's local time shows up as the wrong instant.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { emittedColumns } from '../utils/emitted-columns';
import {
  type EngineCommandResult,
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  runDbSign,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from '../utils/node-without-temporal';

const PRISMA7_SCHEMA = `datasource db {
  provider = "postgresql"
}

model Event {
  id        Int      @id @default(autoincrement())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  happensAt DateTime @db.Timestamptz(6)
  day       DateTime @db.Date
  opensAt   DateTime @db.Time(6)
}
`;

/** What `prisma migrate diff --from-empty --script` from Prisma 7.10.0 writes for `PRISMA7_SCHEMA`. */
const PRISMA7_SQL = `
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "happensAt" TIMESTAMPTZ(6) NOT NULL,
    "day" DATE NOT NULL,
    "opensAt" TIME(6) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
`;

const APP_SCRIPT = `
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const loaded = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    loaded.add(resolved.url);
    return resolved;
  },
});

const { default: postgres } = await import('@prisma/orm-postgres/runtime');
const { contractFromJson } = await import('@prisma/orm-postgres/static');
const dateFields = ['createdAt', 'updatedAt', 'happensAt'];
const withDates = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      dateFields.includes(name) ? new Date(value) : value,
    ]),
  );
const readsDates = (row) => dateFields.every((name) => row[name] instanceof Date);
const writes = JSON.parse(process.env.APP_WRITES);
const db = postgres({
  contract: contractFromJson(JSON.parse(readFileSync('contract.json', 'utf8'))),
  url: process.env.JOURNEY_DB_URL,
});
try {
  const events = db.orm.public.Event;
  const created = await events.create(withDates(writes.create));
  const readAfterCreate = await events.where({ id: created.id }).first();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const updated = await events.where({ id: created.id }).update(withDates(writes.update));
  const readAfterUpdate = await events.where({ id: created.id }).first();
  const [session] = await db.query(
    db.raw.sql\`SELECT EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)::int AS "utcOffsetSeconds"\`
      .returnsRow({ utcOffsetSeconds: 'pg/int4@1' })
      .build(),
  );
  process.stdout.write(
    JSON.stringify({
      created,
      readAfterCreate,
      updated,
      readAfterUpdate,
      readsDates: [created, readAfterCreate, updated, readAfterUpdate].every(readsDates),
      sessionUtcOffsetSeconds: session.utcOffsetSeconds,
      temporalPolyfill: [...loaded].filter((url) => url.includes('temporal-polyfill')),
      timezoneOffset: new Date().getTimezoneOffset(),
    }),
  );
} finally {
  await db.close();
}
`;

const TOKYO_UTC_OFFSET_SECONDS = 9 * 60 * 60;
const TOKYO_UTC_OFFSET_MILLIS = TOKYO_UTC_OFFSET_SECONDS * 1000;

const DATE_COLUMN_CODECS = {
  createdAt: 'pg/timestamp-date@1',
  updatedAt: 'pg/timestamp-date@1',
  happensAt: 'pg/timestamptz-date@1',
  day: 'pg/date-string@1',
  opensAt: 'pg/time-string@1',
};

/** The written values, the timestamps as the JSON text of the JavaScript `Date` the application writes and reads, the others in their ISO 8601 stored form, so a read returns each unchanged. */
const WRITTEN = {
  happensAt: '2024-01-15T10:00:00.123Z',
  day: '2024-01-15',
  opensAt: '08:30:15.25',
};

interface EventRow {
  readonly id: number;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly happensAt: string;
  readonly day: string;
  readonly opensAt: string;
}

interface AppResult {
  readonly created: EventRow;
  readonly readAfterCreate: EventRow;
  readonly updated: EventRow;
  readonly readAfterUpdate: EventRow;
  readonly readsDates: boolean;
  readonly sessionUtcOffsetSeconds: number;
  readonly temporalPolyfill: readonly string[];
  readonly timezoneOffset: number;
}

function output(run: EngineCommandResult): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

/** The instant of a `Date`'s JSON text, or of the ISO 8601 text of a `timestamp`, read as UTC. */
function utcMillis(timestampText: string): number {
  return new Date(timestampText.endsWith('Z') ? timestampText : `${timestampText}Z`).getTime();
}

function expectNow(timestampText: string, before: number, after: number): void {
  const millis = utcMillis(timestampText);
  expect(millis, timestampText).toBeGreaterThanOrEqual(before - 1_000);
  expect(millis, timestampText).toBeLessThanOrEqual(after + 1_000);
}

async function runApp(
  ctx: JourneyContext,
  connectionString: string,
  writes: unknown,
  expectedSessionUtcOffsetSeconds = 0,
) {
  const script = join(ctx.testDir, 'app.mjs');
  writeFileSync(script, APP_SCRIPT, 'utf-8');
  const before = Date.now();
  const run = await runNodeWithoutTemporal([script], {
    cwd: ctx.testDir,
    env: {
      JOURNEY_DB_URL: connectionString,
      APP_WRITES: JSON.stringify(writes),
      TZ: 'Etc/GMT-3',
    },
  });
  const after = Date.now();
  expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
  const result: AppResult = JSON.parse(run.stdout);
  expect(result.temporalPolyfill).toEqual([]);
  expect(result.readsDates, 'every timestamp reads as a JavaScript Date').toBe(true);
  expect(result.timezoneOffset, 'the child runs at UTC+3').toBe(-180);
  expect(
    result.sessionUtcOffsetSeconds,
    "the application's database session time zone, which a database now() default uses",
  ).toBe(expectedSessionUtcOffsetSeconds);
  return { result, before, after };
}

function expectDateCodecs(ctx: JourneyContext): void {
  const columns = emittedColumns(ctx.testDir);
  expect(
    Object.fromEntries(
      Object.keys(DATE_COLUMN_CODECS).map((name) => [name, columns[name]?.codecId]),
    ),
  ).toEqual(DATE_COLUMN_CODECS);
}

function setupPrisma7Project(
  createTempDir: () => string,
  connectionString: string,
): JourneyContext {
  const ctx = setupJourney({ connectionString, createTempDir, contractMode: 'psl' });
  writeFileSync(join(ctx.testDir, 'schema.prisma'), PRISMA7_SCHEMA, 'utf-8');
  const config = readFileSync(
    join(
      __dirname,
      '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma.config.prisma7.ts',
    ),
    'utf-8',
  ).replace(/\{\{DB_URL\}\}/g, () => connectionString);
  writeFileSync(ctx.configPath, config, 'utf-8');
  return ctx;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: an application with no Temporal on a database Prisma 7 created', () => {
    describe('through the contract contract infer writes', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_SQL)),
      });

      it(
        'creates, reads and updates a row, and every date and time value round-trips',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          const infer = await runContractInfer(ctx);
          expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
          expectDateCodecs(ctx);
          const sign = await runDbSign(ctx);
          expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

          const { result, before, after } = await runApp(ctx, db.connectionString, {
            create: { title: 'a', updatedAt: '2024-01-15T09:00:00.500Z', ...WRITTEN },
            update: { title: 'b', updatedAt: '2024-01-15T11:00:00.250Z' },
          });

          expect(result.created).toEqual({
            id: result.created.id,
            title: 'a',
            createdAt: result.created.createdAt,
            updatedAt: '2024-01-15T09:00:00.500Z',
            ...WRITTEN,
          });
          expectNow(result.created.createdAt, before, after);
          expect(result.readAfterCreate).toEqual(result.created);
          expect(result.updated).toEqual({
            ...result.created,
            title: 'b',
            updatedAt: '2024-01-15T11:00:00.250Z',
          });
          expect(result.readAfterUpdate).toEqual(result.updated);
        },
        timeouts.spinUpPpgDev * 2,
      );
    });

    describe('through the contract prisma7Schema(...) reads from the Prisma 7 schema', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_SQL)),
      });

      it(
        'creates, reads and updates a row, sets updatedAt to the current instant, and every date and time value round-trips',
        async () => {
          const ctx = setupPrisma7Project(createTempDir, db.connectionString);
          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
          expectDateCodecs(ctx);
          const sign = await runDbSign(ctx);
          expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

          const { result, before, after } = await runApp(ctx, db.connectionString, {
            create: { title: 'a', ...WRITTEN },
            update: { title: 'b' },
          });

          expect(result.created).toEqual({
            id: result.created.id,
            title: 'a',
            createdAt: result.created.createdAt,
            updatedAt: result.created.updatedAt,
            ...WRITTEN,
          });
          expectNow(result.created.createdAt, before, after);
          expectNow(result.created.updatedAt, before, after);
          expect(result.readAfterCreate).toEqual(result.created);
          expect(result.updated).toEqual({
            ...result.created,
            title: 'b',
            updatedAt: result.updated.updatedAt,
          });
          expectNow(result.updated.updatedAt, before, after);
          expect(utcMillis(result.updated.updatedAt)).toBeGreaterThan(
            utcMillis(result.created.updatedAt),
          );
          expect(result.readAfterUpdate).toEqual(result.updated);
        },
        timeouts.spinUpPpgDev * 2,
      );
    });

    describe('through prisma7Schema(...), on a session in Asia/Tokyo', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_SQL)),
      });

      it(
        'stores the current UTC time on a create, and a raw INSERT still gets the database default',
        async () => {
          const ctx = setupPrisma7Project(createTempDir, db.connectionString);
          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
          const sign = await runDbSign(ctx);
          expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
          await withClient(db.connectionString, (client) =>
            client.query("SET TIME ZONE 'Asia/Tokyo'"),
          );

          const { result, before, after } = await runApp(
            ctx,
            db.connectionString,
            { create: { title: 'a', ...WRITTEN }, update: { title: 'b' } },
            TOKYO_UTC_OFFSET_SECONDS,
          );
          expectNow(result.created.createdAt, before, after);
          expect(result.readAfterCreate).toEqual(result.created);

          const rawBefore = Date.now();
          const raw = await withClient(db.connectionString, (client) =>
            client.query<{ createdAt: string }>(
              `INSERT INTO "Event" ("title", "updatedAt", "happensAt", "day", "opensAt")
               VALUES ('raw', now(), now(), current_date, current_time)
               RETURNING "createdAt"::text AS "createdAt"`,
            ),
          );
          const rawAfter = Date.now();
          const rawCreatedAt = raw.rows[0]?.createdAt ?? '';
          expectNow(
            rawCreatedAt,
            rawBefore + TOKYO_UTC_OFFSET_MILLIS,
            rawAfter + TOKYO_UTC_OFFSET_MILLIS,
          );
        },
        timeouts.spinUpPpgDev * 2,
      );
    });
  });
});
