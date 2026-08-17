/**
 * The Temporal-backed codecs against a real PostgreSQL, through the whole runtime.
 *
 * The codec-level suite in `@internal/target-postgres` covers the boundaries exhaustively against
 * literal spellings. What only a database can settle is the other half: that those spellings are
 * the ones a server actually emits, and that what PostgreSQL does to a value on the way in — round
 * a nanosecond, carry it into the next second, re-render an instant in the session's zone — comes
 * back as the value this representation promises.
 *
 * Also here rather than in the codec suite: the generic decode path. `RUNTIME.TEMPORAL_UNAVAILABLE`
 * has to survive it with its code intact, and that path lives in the SQL runtime.
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
import {
  buildDecodeContext,
  buildTestContractCodecs,
  createTestRuntime,
  decodeRow,
} from '@internal/sql-runtime/test/utils';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../2-sql/1-core/contract/test/test-support';
import postgresRuntimeAdapterDescriptorFull from '../src/exports/runtime';

const { queryOperations: _stripOps, ...postgresRuntimeAdapterDescriptor } =
  postgresRuntimeAdapterDescriptorFull;

const DATE = { codecId: 'pg/date-temporal@1' } as const;
const TIMESTAMP = { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 6 } } as const;
const TIMESTAMPTZ = { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 6 } } as const;
const TIME = { codecId: 'pg/time-temporal@1', typeParams: { precision: 6 } } as const;

interface MomentRow {
  readonly d: Temporal.PlainDate;
  readonly ts: Temporal.PlainDateTime;
  readonly tstz: Temporal.Instant;
  readonly t: Temporal.PlainTime;
}

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('temporal-codec-roundtrip'),
    storage: new SqlStorage({
      storageHash: coreHash('temporal-codec-roundtrip'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Moments: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  d: { nativeType: 'date', codecId: DATE.codecId, nullable: true },
                  ts: {
                    nativeType: 'timestamp',
                    codecId: TIMESTAMP.codecId,
                    typeParams: TIMESTAMP.typeParams,
                    nullable: true,
                  },
                  tstz: {
                    nativeType: 'timestamptz',
                    codecId: TIMESTAMPTZ.codecId,
                    typeParams: TIMESTAMPTZ.typeParams,
                    nullable: true,
                  },
                  t: {
                    nativeType: 'time',
                    codecId: TIME.codecId,
                    typeParams: TIME.typeParams,
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

interface WriteRow {
  readonly id: number;
  readonly d: Temporal.PlainDate | null;
  readonly ts: Temporal.PlainDateTime | null;
  readonly tstz: Temporal.Instant | null;
  readonly t: Temporal.PlainTime | null;
}

function buildInsertAst(row: WriteRow): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(row.id, { codec: { codecId: 'pg/int4@1' } }),
      d: ParamRef.of(row.d, { codec: DATE }),
      ts: ParamRef.of(row.ts, { codec: TIMESTAMP }),
      tstz: ParamRef.of(row.tstz, { codec: TIMESTAMPTZ }),
      t: ParamRef.of(row.t, { codec: TIME }),
    },
  ]);
}

function buildSelectByIdAst(id: number): SelectAst {
  return SelectAst.from(TABLE)
    .withProjection([
      ProjectionItem.of('d', ColumnRef.of('Moments', 'd'), DATE),
      ProjectionItem.of('ts', ColumnRef.of('Moments', 'ts'), TIMESTAMP),
      ProjectionItem.of('tstz', ColumnRef.of('Moments', 'tstz'), TIMESTAMPTZ),
      ProjectionItem.of('t', ColumnRef.of('Moments', 't'), TIME),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('Moments', 'id'),
        ParamRef.of(id, { codec: { codecId: 'pg/int4@1' } }),
      ),
    );
}

describe.sequential('Temporal codecs round-trip through PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;
  let session: ReturnType<typeof postgresRuntimeDriverDescriptor.create> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    const client = new pg.Client({ connectionString: database.connectionString });

    const stack = createSqlExecutionStack({
      target: postgresRuntimeTargetDescriptor,
      adapter: postgresRuntimeAdapterDescriptor,
      extensions: [],
    });
    const context = createExecutionContext({ contract: buildContract(), stack });
    const stackInstance = instantiateExecutionStack(stack);

    // A pinned client: the DateStyle test sets a session variable and then reads on the same
    // session, which only holds when every statement runs on one connection.
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgClient', client });
    session = driver;
    runtime = createTestRuntime({ stackInstance, context, driver, verifyMarker: false });

    await driver.execute({ sql: "SET TimeZone TO 'UTC'" });
    await driver.execute({
      sql: `CREATE TABLE "Moments" (
        id int4 PRIMARY KEY, d date, ts timestamp(6), tstz timestamptz(6), t time(6)
      )`,
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  async function insert(row: WriteRow): Promise<void> {
    await runtime!.query(planFromAst(buildInsertAst(row), buildContract())).toArray();
  }

  async function read(id: number): Promise<MomentRow> {
    const rows = await runtime!
      .query(planFromAst(buildSelectByIdAst(id), buildContract()))
      .toArray();
    expect(rows).toHaveLength(1);
    return rows[0] as unknown as MomentRow;
  }

  // Reads without asserting a shape: the rejection cases only care that the decode throws.
  async function readRaw(id: number): Promise<unknown> {
    const rows = await runtime!
      .query(planFromAst(buildSelectByIdAst(id), buildContract()))
      .toArray();
    return rows[0];
  }

  it('round-trips ordinary values as the Temporal types the column declares', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({
      id: 1,
      d: Temporal.PlainDate.from('2026-01-02'),
      ts: Temporal.PlainDateTime.from('2026-01-02T03:04:05.123456'),
      tstz: Temporal.Instant.from('2026-01-02T03:04:05.123456Z'),
      t: Temporal.PlainTime.from('03:04:05.123456'),
    });

    const row = await read(1);

    expect({
      types: [
        row.d instanceof Temporal.PlainDate,
        row.ts instanceof Temporal.PlainDateTime,
        row.tstz instanceof Temporal.Instant,
        row.t instanceof Temporal.PlainTime,
      ],
      values: [row.d.toString(), row.ts.toString(), row.tstz.toString(), row.t.toString()],
    }).toEqual({
      types: [true, true, true, true],
      values: [
        '2026-01-02',
        '2026-01-02T03:04:05.123456',
        '2026-01-02T03:04:05.123456Z',
        '03:04:05.123456',
      ],
    });
  });

  it('sends nanoseconds and reads back what PostgreSQL rounded them to, carry included', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({
      id: 2,
      d: null,
      // .999999999 rounds up through every field: second, minute, hour, and the date.
      ts: Temporal.PlainDateTime.from('2026-01-02T23:59:59.999999999'),
      tstz: Temporal.Instant.from('2026-01-02T03:04:05.123456789Z'),
      t: null,
    });

    const row = await read(2);

    expect([row.ts.toString(), row.tstz.toString()]).toEqual([
      '2026-01-03T00:00:00',
      '2026-01-02T03:04:05.123457Z',
    ]);
  });

  it('reads the same instant back whatever zone the session renders it in', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const zones = ['Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Chatham', 'UTC'];
    const read1 = [];
    for (const zone of zones) {
      await session!.execute({ sql: `SET TimeZone TO '${zone}'` });
      read1.push((await read(1)).tstz.toString());
    }

    expect(read1).toEqual(Array(4).fill('2026-01-02T03:04:05.123456Z'));
  });

  it('reads BC and expanded-year values that PostgreSQL stores and Temporal spells differently', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    // Written as SQL literals: PostgreSQL rejects Temporal's own signed-year spelling on input,
    // reading the leading sign as a time zone displacement. Reads are what this covers.
    await session!.execute({
      sql: `INSERT INTO "Moments" (id, d, ts, tstz, t) VALUES
          (3, date '0044-03-15 BC', timestamp '0044-03-15 12:00:00 BC',
              timestamptz '0044-03-15 12:00:00+00 BC', null),
          (4, date '12026-01-02', timestamp '12026-01-02 03:04:05',
              timestamptz '12026-01-02 03:04:05+00', null)`,
    });

    const bc = await read(3);
    const expanded = await read(4);

    expect([
      bc.d.toString(),
      bc.ts.toString(),
      bc.tstz.toString(),
      expanded.d.toString(),
      expanded.ts.toString(),
      expanded.tstz.toString(),
    ]).toEqual([
      '-000043-03-15',
      '-000043-03-15T12:00:00',
      '-000043-03-15T12:00:00Z',
      '+012026-01-02',
      '+012026-01-02T03:04:05',
      '+012026-01-02T03:04:05Z',
    ]);
  });

  it('rejects infinity out of the database and names the string type that reads it', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({
      sql: `INSERT INTO "Moments" (id, d, ts, tstz, t) VALUES (5, 'infinity', null, null, null)`,
    });

    await expect(readRaw(5)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'pg/date-temporal@1', stringType: 'DateString' },
    });
  });

  it('rejects a non-ISO DateStyle rendering rather than guessing at it', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({ sql: "SET DateStyle TO 'German, DMY'" });
    try {
      await expect(readRaw(1)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { value: '02.01.2026', stringType: 'DateString' },
      });
    } finally {
      await session!.execute({ sql: "SET DateStyle TO 'ISO, MDY'" });
    }
  });

  it('forwards RUNTIME.TEMPORAL_UNAVAILABLE through the generic decode path with its code intact', async () => {
    const descriptor = postgresCodecDescriptorRegistry.descriptorFor(TIMESTAMPTZ.codecId);
    const codec = descriptor!.factory(TIMESTAMPTZ.typeParams)({ name: '<test>' });
    const tstzOnly = SelectAst.from(TABLE).withProjection([
      ProjectionItem.of('tstz', ColumnRef.of('Moments', 'tstz'), TIMESTAMPTZ),
    ]);
    const decodeCtx = buildDecodeContext(tstzOnly, buildTestContractCodecs([codec]));

    const original = Reflect.get(globalThis, 'Temporal');
    Reflect.deleteProperty(globalThis, 'Temporal');
    try {
      await expect(
        decodeRow({ tstz: '2026-01-02 03:04:05.123456+00' }, decodeCtx, {}),
      ).rejects.toMatchObject({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        meta: { codecId: 'pg/timestamptz-temporal@1', operation: 'decode' },
      });
    } finally {
      Reflect.set(globalThis, 'Temporal', original);
    }
  });
});
