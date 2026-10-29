/**
 * Journey: a schema written with the convenience date and time types `DateTime`, `Date`, `Time` and `Duration`, at their defaults and with the choices that need no `Temporal`, emits, creates its table, and is written and read by an application that runs with no global `Temporal`. Each field reads the kind of value its convenience type chooses: a JavaScript `Date` for `DateTime`, a string for `Date`, `Time` and `Duration`, and the `{ months, days, micros }` object for `Duration(as: parts)`. The client generates `updatedAt` with `now()` in that process.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { emittedColumns } from '../utils/emitted-columns';
import {
  type EngineCommandResult,
  runContractEmit,
  runDbInit,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from '../utils/node-without-temporal';

const SCHEMA = `// use prisma-8

model Order {
  id        Int                                   @id
  paidAt    DateTime
  legacyAt  DateTime(storage: timestamp)
  textAt    DateTime(as: string, precision: 6)
  shipBy    Date
  opensAt   Time(precision: 0)
  localAt   Time(storage: timetz)
  period    Duration
  parts     Duration(as: parts)
  settledAt DateTime(as: temporal)?
  updatedAt DateTime @onCreate(now()) @onUpdate(now())

  @@map("order")
}
`;

const APP_SCRIPT = `
import { readFileSync } from 'node:fs';

const { default: postgres } = await import('@prisma/orm-postgres/runtime');
const { contractFromJson } = await import('@prisma/orm-postgres/static');
const db = postgres({
  contract: contractFromJson(JSON.parse(readFileSync('contract.json', 'utf8'))),
  url: process.env.JOURNEY_DB_URL,
});
const described = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([name, value]) => [
      name,
      value instanceof Date
        ? { kind: 'Date', value: value.toISOString() }
        : value !== null && typeof value === 'object'
          ? {
              kind: 'object',
              value: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])),
            }
          : { kind: value === null ? 'null' : typeof value, value },
    ]),
  );
try {
  const orders = db.orm.public.Order;
  await orders.create({
    id: 1,
    paidAt: new Date('2024-02-29T10:00:00.123Z'),
    legacyAt: new Date('2024-02-29T10:00:00.5Z'),
    textAt: '2024-02-29T10:00:00.123456Z',
    shipBy: '2024-02-29',
    opensAt: '09:30:00',
    localAt: '09:30:00+02:00',
    period: 'P1M',
    parts: { months: 1, days: 2, micros: 3n },
    settledAt: null,
  });
  const read = await orders.where({ id: 1 }).first();
  process.stdout.write(JSON.stringify(described(read)));
} finally {
  await db.close();
}
`;

const COLUMN_CODECS = {
  paidAt: 'pg/timestamptz-date@1',
  legacyAt: 'pg/timestamp-date@1',
  textAt: 'pg/timestamptz-string@1',
  shipBy: 'pg/date-string@1',
  opensAt: 'pg/time-string@1',
  localAt: 'pg/timetz@1',
  period: 'pg/interval-string@1',
  parts: 'pg/interval@1',
  settledAt: 'pg/timestamptz-temporal@1',
  updatedAt: 'pg/timestamptz-date@1',
};

function output(run: EngineCommandResult): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: the convenience date and time types in an application with no Temporal', () => {
    const db = useDevDatabase();

    it(
      'emits each field as the explicit type it chooses, and reads the value that type gives',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const columns = emittedColumns(ctx.testDir);
        expect(
          Object.fromEntries(
            Object.keys(COLUMN_CODECS).map((name) => [name, columns[name]?.codecId]),
          ),
        ).toEqual(COLUMN_CODECS);
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        const script = join(ctx.testDir, 'app.mjs');
        writeFileSync(script, APP_SCRIPT, 'utf-8');
        const before = Date.now();
        const run = await runNodeWithoutTemporal([script], {
          cwd: ctx.testDir,
          env: { JOURNEY_DB_URL: db.connectionString },
        });
        const after = Date.now();
        expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

        const read = JSON.parse(run.stdout);
        expect(read).toEqual({
          id: { kind: 'number', value: 1 },
          paidAt: { kind: 'Date', value: '2024-02-29T10:00:00.123Z' },
          legacyAt: { kind: 'Date', value: '2024-02-29T10:00:00.500Z' },
          textAt: { kind: 'string', value: '2024-02-29T10:00:00.123456Z' },
          shipBy: { kind: 'string', value: '2024-02-29' },
          opensAt: { kind: 'string', value: '09:30:00' },
          localAt: { kind: 'string', value: '09:30:00+02:00' },
          period: { kind: 'string', value: 'P1M' },
          parts: { kind: 'object', value: { months: '1', days: '2', micros: '3' } },
          settledAt: { kind: 'null', value: null },
          updatedAt: { kind: 'Date', value: read.updatedAt.value },
        });
        const updatedAt = new Date(read.updatedAt.value).getTime();
        expect(updatedAt).toBeGreaterThanOrEqual(before - 1_000);
        expect(updatedAt).toBeLessThanOrEqual(after + 1_000);
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
