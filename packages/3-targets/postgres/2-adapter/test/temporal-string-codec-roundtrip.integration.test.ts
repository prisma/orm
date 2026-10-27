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
import { createTestSqlNamespace } from '../../../../2-sql-family/1-core/contract/test/test-support';
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
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  d: { dataType: 'pg/date', codecId: DATE_CODEC.codecId, nullable: true },
                  ts: {
                    dataType: 'pg/timestamp',
                    codecId: TIMESTAMP_CODEC.codecId,
                    typeParams: TIMESTAMP_CODEC.typeParams,
                    nullable: true,
                  },
                  tstz: {
                    dataType: 'pg/timestamptz',
                    codecId: TIMESTAMPTZ_CODEC.codecId,
                    typeParams: TIMESTAMPTZ_CODEC.typeParams,
                    nullable: true,
                  },
                  t: {
                    dataType: 'pg/time',
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

describe('the string date and time codecs read ISO 8601 from PostgreSQL', () => {
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

    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgClient', client, ownedByDriver: true });
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

  it('reads back microsecond precision that a millisecond-resolution value would truncate, in ISO 8601', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await insert({
      id: 1,
      d: '2026-01-02',
      ts: '2026-01-02T03:04:05.123456',
      tstz: '2026-01-02T03:04:05.123456Z',
      t: '03:04:05.123456',
    });

    expect(await read(1)).toEqual({
      d: '2026-01-02',
      ts: '2026-01-02T03:04:05.123456',
      tstz: '2026-01-02T03:04:05.123456Z',
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

  it('round-trips a year before Christ and an expanded year in their ISO 8601 form', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const beforeChrist = {
      id: 4,
      d: '-000043-03-15',
      ts: '-000043-03-15T12:00:00',
      tstz: '-000043-03-15T12:00:00Z',
      t: null,
    };
    const expanded = {
      id: 5,
      d: '+012026-01-02',
      ts: '+012026-01-02T03:04:05',
      tstz: '+012026-01-02T03:04:05Z',
      t: null,
    };
    await insert(beforeChrist);
    await insert(expanded);

    const { id: _4, ...beforeChristRow } = beforeChrist;
    const { id: _5, ...expandedRow } = expanded;
    expect([await read(4), await read(5)]).toEqual([beforeChristRow, expandedRow]);
  });

  it('reads a timestamptz as the same UTC instant whatever the session TimeZone', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({ sql: "SET TimeZone TO 'Asia/Tokyo'" });
    try {
      expect((await read(1)).tstz).toBe('2026-01-02T03:04:05.123456Z');
    } finally {
      await session!.execute({ sql: "SET TimeZone TO 'UTC'" });
    }
  });

  it('refuses to read a date the session prints under another DateStyle, naming the setting', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await session!.execute({ sql: "SET DateStyle TO 'German, DMY'" });
    try {
      await expect(read(1)).rejects.toMatchObject({
        code: 'RUNTIME.DATE_STYLE_NOT_ISO',
        meta: { codecId: 'pg/date-string@1', received: '02.01.2026' },
      });
    } finally {
      await session!.execute({ sql: "SET DateStyle TO 'ISO, MDY'" });
    }
  });
});
