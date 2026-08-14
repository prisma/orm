/**
 * Full-stack proof that the `*-string` temporal codecs are a lossless escape hatch.
 *
 * Two properties, neither of which a unit test can establish, because both are about what a real
 * PostgreSQL server does rather than about what the codec does:
 *
 * - Values with no counterpart in a richer temporal representation — `infinity`, BC dates, expanded
 *   years, microsecond precision — survive a write and a read with the server's rendering intact.
 * - Session settings that change how the server renders a stored value are *observable* through
 *   these codecs. Nothing between the wire and the application re-formats or pins the output, so a
 *   non-default `DateStyle` or `TimeZone` shows up in the value the caller receives.
 *
 * The whole suite runs with no global `Temporal`, which is the point of the representation.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  InsertAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
} from '@internal/sql-runtime';
import { createTestRuntime } from '@internal/sql-runtime/test/utils';
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../2-sql/1-core/contract/test/test-support';
import postgresRuntimeAdapterDescriptorFull from '../src/exports/runtime';

const { queryOperations: _stripOps, ...postgresRuntimeAdapterDescriptor } =
  postgresRuntimeAdapterDescriptorFull;

const DATE_CODEC = { codecId: 'pg/date-string@1' } as const;
const TIMESTAMP_CODEC = {
  codecId: 'pg/timestamp-string@1',
  typeParams: { precision: 6 },
} as const;
const TIMESTAMPTZ_CODEC = {
  codecId: 'pg/timestamptz-string@1',
  typeParams: { precision: 6 },
} as const;
const TIME_CODEC = { codecId: 'pg/time-string@1', typeParams: { precision: 6 } } as const;

interface TemporalRow {
  readonly d: string | null;
  readonly ts: string | null;
  readonly tstz: string | null;
  readonly t: string | null;
}

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('temporal-string-codec-roundtrip'),
    storage: new SqlStorage({
      storageHash: coreHash('temporal-string-codec-roundtrip'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Moments: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  d: { nativeType: 'date', codecId: DATE_CODEC.codecId, nullable: true },
                  ts: {
                    nativeType: 'timestamp',
                    codecId: TIMESTAMP_CODEC.codecId,
                    typeParams: TIMESTAMP_CODEC.typeParams,
                    nullable: true,
                  },
                  tstz: {
                    nativeType: 'timestamptz',
                    codecId: TIMESTAMPTZ_CODEC.codecId,
                    typeParams: TIMESTAMPTZ_CODEC.typeParams,
                    nullable: true,
                  },
                  t: {
                    nativeType: 'time',
                    codecId: TIME_CODEC.codecId,
                    typeParams: TIME_CODEC.typeParams,
                    nullable: true,
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const TABLE = TableSource.named('Moments');

function buildInsertAst(row: {
  id: number;
  d: string | null;
  ts: string | null;
  tstz: string | null;
  t: string | null;
}): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(row.id, { codec: { codecId: 'pg/int4@1' } }),
      d: ParamRef.of(row.d, { codec: DATE_CODEC }),
      ts: ParamRef.of(row.ts, { codec: TIMESTAMP_CODEC }),
      tstz: ParamRef.of(row.tstz, { codec: TIMESTAMPTZ_CODEC }),
      t: ParamRef.of(row.t, { codec: TIME_CODEC }),
    },
  ]);
}

function buildSelectByIdAst(id: number): SelectAst {
  return SelectAst.from(TABLE)
    .withProjection([
      ProjectionItem.of('d', ColumnRef.of('Moments', 'd'), DATE_CODEC),
      ProjectionItem.of('ts', ColumnRef.of('Moments', 'ts'), TIMESTAMP_CODEC),
      ProjectionItem.of('tstz', ColumnRef.of('Moments', 'tstz'), TIMESTAMPTZ_CODEC),
      ProjectionItem.of('t', ColumnRef.of('Moments', 't'), TIME_CODEC),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('Moments', 'id'),
        ParamRef.of(id, { codec: { codecId: 'pg/int4@1' } }),
      ),
    );
}

describe.sequential('temporal string codecs round-trip PostgreSQL text', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;
  let session: ReturnType<typeof postgresRuntimeDriverDescriptor.create> | undefined;
  let hadTemporal = false;
  let originalTemporal: unknown;

  beforeAll(async () => {
    hadTemporal = Object.hasOwn(globalThis, 'Temporal');
    originalTemporal = Reflect.get(globalThis, 'Temporal');
    Reflect.deleteProperty(globalThis, 'Temporal');

    database = await createDevDatabase();
    const client = new pg.Client({ connectionString: database.connectionString });

    const stack = createSqlExecutionStack({
      target: postgresRuntimeTargetDescriptor,
      adapter: postgresRuntimeAdapterDescriptor,
      extensions: [],
    });
    const context = createExecutionContext({ contract: buildContract(), stack });
    const stackInstance = instantiateExecutionStack(stack);

    // A pinned client, not a pool: the session-rendering tests below issue `SET` and then read on
    // the same session, which only holds when every statement runs on one connection.
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgClient', client });
    session = driver;
    runtime = createTestRuntime({ stackInstance, context, driver, verifyMarker: false });

    await driver.execute({
      sql: `CREATE TABLE "Moments" (
        id   int4 PRIMARY KEY,
        d    date,
        ts   timestamp(6),
        tstz timestamptz(6),
        t    time(6)
      )`,
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    if (database) await database.close();
    if (hadTemporal) {
      Reflect.set(globalThis, 'Temporal', originalTemporal);
    }
  }, timeouts.spinUpPpgDev);

  async function insert(row: {
    id: number;
    d: string | null;
    ts: string | null;
    tstz: string | null;
    t: string | null;
  }): Promise<void> {
    const contract = buildContract();
    await runtime!.query(planFromAst(buildInsertAst(row), contract)).toArray();
  }

  async function read(id: number): Promise<TemporalRow> {
    const contract = buildContract();
    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(id), contract)).toArray();
    expect(rows).toHaveLength(1);
    return rows[0] as unknown as TemporalRow;
  }

  it('runs with no global Temporal', () => {
    expect('Temporal' in globalThis).toBe(false);
  });

  it('preserves microsecond precision that a millisecond-resolution value would truncate', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({
      id: 1,
      d: '2026-01-02',
      ts: '2026-01-02 03:04:05.123456',
      tstz: '2026-01-02 03:04:05.123456+00',
      t: '03:04:05.123456',
    });

    expect(await read(1)).toEqual({
      d: '2026-01-02',
      ts: '2026-01-02 03:04:05.123456',
      tstz: '2026-01-02 03:04:05.123456+00',
      t: '03:04:05.123456',
    });
  });

  it('round-trips infinity and -infinity, which have no instant to represent', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({ id: 2, d: 'infinity', ts: 'infinity', tstz: 'infinity', t: null });
    await insert({ id: 3, d: '-infinity', ts: '-infinity', tstz: '-infinity', t: null });

    expect(await read(2)).toEqual({ d: 'infinity', ts: 'infinity', tstz: 'infinity', t: null });
    expect(await read(3)).toEqual({
      d: '-infinity',
      ts: '-infinity',
      tstz: '-infinity',
      t: null,
    });
  });

  it('round-trips a BC date and an expanded year, which fall outside the representable range', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({
      id: 4,
      d: '0044-03-15 BC',
      ts: '0044-03-15 12:00:00 BC',
      tstz: '0044-03-15 12:00:00+00 BC',
      t: null,
    });
    await insert({
      id: 5,
      d: '12026-01-02',
      ts: '12026-01-02 03:04:05',
      tstz: '12026-01-02 03:04:05+00',
      t: null,
    });

    expect(await read(4)).toEqual({
      d: '0044-03-15 BC',
      ts: '0044-03-15 12:00:00 BC',
      tstz: '0044-03-15 12:00:00+00 BC',
      t: null,
    });
    expect(await read(5)).toEqual({
      d: '12026-01-02',
      ts: '12026-01-02 03:04:05',
      tstz: '12026-01-02 03:04:05+00',
      t: null,
    });
  });

  it('surfaces the session TimeZone in the rendering instead of pinning the read to UTC', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({ sql: "SET TimeZone TO 'Asia/Tokyo'" });
    try {
      expect((await read(1)).tstz).toBe('2026-01-02 12:04:05.123456+09');
    } finally {
      await session!.execute({ sql: "SET TimeZone TO 'UTC'" });
    }
  });

  it('surfaces a non-default DateStyle in the rendering instead of normalising it away', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({ sql: "SET DateStyle TO 'German, DMY'" });
    try {
      expect(await read(1)).toEqual({
        d: '02.01.2026',
        ts: '02.01.2026 03:04:05.123456',
        // German DateStyle swaps the numeric offset for the zone abbreviation — a rendering no
        // client-side formatter would produce, and the clearest evidence the server's own text is
        // what reaches the caller.
        tstz: '02.01.2026 03:04:05.123456 UTC',
        t: '03:04:05.123456',
      });
    } finally {
      await session!.execute({ sql: "SET DateStyle TO 'ISO, MDY'" });
    }
  });
});
