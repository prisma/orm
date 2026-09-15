/**
 * Integration test: element-wise encode/decode round-trip for many (scalar-list) columns.
 *
 * Verifies that the runtime codec path correctly maps the element codec over
 * target-parsed list elements when the column's CodecRef carries `many: true`.
 * It covers DateTime (pg/timestamptz-temporal@1), Bytes (pg/bytea@1), Decimal
 * (pg/numeric@1), BigInt (pg/int8@1), and parser-normalized builtin scalar
 * types whose raw Postgres array element text must still reach the application
 * as booleans or numbers.
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
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf, createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../2-sql/1-core/contract/test/test-support';
import postgresRuntimeAdapterDescriptorFull from '../src/exports/runtime';
import { defineTestCodec } from './test-codec';

// Strip queryOperations from the adapter descriptor so that
// operations registered only in the slice-3 prototype do not prevent
// createExecutionContext from constructing the execution context.
const { queryOperations: _stripOps, ...postgresRuntimeAdapterDescriptor } =
  postgresRuntimeAdapterDescriptorFull;

const nativeArrayListDecoder = async (
  wireValue: unknown,
  decodeElement: (value: unknown) => Promise<unknown>,
): Promise<readonly unknown[]> => {
  if (!Array.isArray(wireValue)) {
    throw new TypeError(
      `expected an array from the driver for many-typed column, got ${typeof wireValue}`,
    );
  }
  return Promise.all(wireValue.map(decodeElement));
};

// ---------------------------------------------------------------------------
// Typed contract with many:true columns for all four element types under test
// ---------------------------------------------------------------------------

function buildListContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('scalar-list-codec-roundtrip'),
    storage: new SqlStorage({
      storageHash: coreHash('scalar-list-codec-roundtrip'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              ListTest: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  dates: {
                    nativeType: 'timestamptz',
                    codecId: 'pg/timestamptz-temporal@1',
                    nullable: true,
                    many: true,
                  },
                  bytes: {
                    nativeType: 'bytea',
                    codecId: 'pg/bytea@1',
                    nullable: true,
                    many: true,
                  },
                  decimals: {
                    nativeType: 'numeric',
                    codecId: 'pg/numeric@1',
                    typeParams: { precision: 30, scale: 10 },
                    nullable: true,
                    many: true,
                  },
                  bigints: {
                    nativeType: 'int8',
                    codecId: 'pg/int8@1',
                    nullable: true,
                    many: true,
                  },
                  bools: {
                    nativeType: 'bool',
                    codecId: 'pg/bool@1',
                    nullable: true,
                    many: true,
                  },
                  shorts: {
                    nativeType: 'int2',
                    codecId: 'pg/int2@1',
                    nullable: true,
                    many: true,
                  },
                  ints: {
                    nativeType: 'int4',
                    codecId: 'pg/int4@1',
                    nullable: true,
                    many: true,
                  },
                  singles: {
                    nativeType: 'float4',
                    codecId: 'pg/float4@1',
                    nullable: true,
                    many: true,
                  },
                  doubles: {
                    nativeType: 'float8',
                    codecId: 'pg/float8@1',
                    nullable: true,
                    many: true,
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

// ---------------------------------------------------------------------------
// AST builders for parameterized insert and select
// ---------------------------------------------------------------------------

const TABLE = TableSource.named('ListTest');

function buildInsertAst(row: {
  id: number;
  dates?: Temporal.Instant[] | null;
  bytes?: Uint8Array[] | null;
  decimals?: string[] | null;
  bigints?: bigint[] | null;
  bools?: boolean[] | null;
  shorts?: number[] | null;
  ints?: number[] | null;
  singles?: number[] | null;
  doubles?: number[] | null;
}): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(row.id, { codec: { codecId: 'pg/int4@1' } }),
      dates: ParamRef.of(row.dates ?? null, {
        codec: { codecId: 'pg/timestamptz-temporal@1', many: true },
      }),
      bytes: ParamRef.of(row.bytes ?? null, { codec: { codecId: 'pg/bytea@1', many: true } }),
      decimals: ParamRef.of(row.decimals ?? null, {
        codec: { codecId: 'pg/numeric@1', typeParams: { precision: 30, scale: 10 }, many: true },
      }),
      bigints: ParamRef.of(row.bigints ?? null, { codec: { codecId: 'pg/int8@1', many: true } }),
      bools: ParamRef.of(row.bools ?? null, { codec: { codecId: 'pg/bool@1', many: true } }),
      shorts: ParamRef.of(row.shorts ?? null, { codec: { codecId: 'pg/int2@1', many: true } }),
      ints: ParamRef.of(row.ints ?? null, { codec: { codecId: 'pg/int4@1', many: true } }),
      singles: ParamRef.of(row.singles ?? null, {
        codec: { codecId: 'pg/float4@1', many: true },
      }),
      doubles: ParamRef.of(row.doubles ?? null, {
        codec: { codecId: 'pg/float8@1', many: true },
      }),
    },
  ]);
}

function buildSelectByIdAst(id: number): SelectAst {
  return SelectAst.from(TABLE)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('ListTest', 'id'), { codecId: 'pg/int4@1' }),
      ProjectionItem.of('dates', ColumnRef.of('ListTest', 'dates'), {
        codecId: 'pg/timestamptz-temporal@1',
        many: true,
      }),
      ProjectionItem.of('bytes', ColumnRef.of('ListTest', 'bytes'), {
        codecId: 'pg/bytea@1',
        many: true,
      }),
      ProjectionItem.of('decimals', ColumnRef.of('ListTest', 'decimals'), {
        codecId: 'pg/numeric@1',
        typeParams: { precision: 30, scale: 10 },
        many: true,
      }),
      ProjectionItem.of('bigints', ColumnRef.of('ListTest', 'bigints'), {
        codecId: 'pg/int8@1',
        many: true,
      }),
      ProjectionItem.of('bools', ColumnRef.of('ListTest', 'bools'), {
        codecId: 'pg/bool@1',
        many: true,
      }),
      ProjectionItem.of('shorts', ColumnRef.of('ListTest', 'shorts'), {
        codecId: 'pg/int2@1',
        many: true,
      }),
      ProjectionItem.of('ints', ColumnRef.of('ListTest', 'ints'), {
        codecId: 'pg/int4@1',
        many: true,
      }),
      ProjectionItem.of('singles', ColumnRef.of('ListTest', 'singles'), {
        codecId: 'pg/float4@1',
        many: true,
      }),
      ProjectionItem.of('doubles', ColumnRef.of('ListTest', 'doubles'), {
        codecId: 'pg/float8@1',
        many: true,
      }),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('ListTest', 'id'),
        ParamRef.of(id, { codec: { codecId: 'pg/int4@1' } }),
      ),
    );
}

// ---------------------------------------------------------------------------
// Integration tests — shared runtime to avoid dev-database connection limits
// ---------------------------------------------------------------------------

describe('scalar-list codec round-trip (element-wise encode/decode)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();

    await withClient(database.connectionString, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "ListTest" (
          id       int4 PRIMARY KEY,
          dates    timestamptz[],
          bytes    bytea[],
          decimals numeric[],
          bigints  int8[],
          bools    bool[],
          shorts   int2[],
          ints     int4[],
          singles  float4[],
          doubles  float8[]
        )
      `);
    });

    const contract = buildListContract();
    const stack = createSqlExecutionStack({
      target: postgresRuntimeTargetDescriptor,
      adapter: postgresRuntimeAdapterDescriptor,
      extensions: [],
    });
    const context = createExecutionContext({ contract, stack });
    const stackInstance = instantiateExecutionStack(stack);

    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'url', url: database.connectionString });

    runtime = createTestRuntime({ stackInstance, context, driver, verifyMarker: false });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  function getContract(): Contract<SqlStorage> {
    return buildListContract();
  }

  it('round-trips DateTime[] with per-element codec fidelity', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    const dates = [
      Temporal.Instant.from('2026-01-02T03:04:05Z'),
      Temporal.Instant.from('2025-06-15T12:00:00Z'),
    ];

    await runtime!
      .query(
        planFromAst(
          buildInsertAst({ id: 100, dates, bytes: null, decimals: null, bigints: null }),
          contract,
        ),
      )
      .toArray();

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(100), contract)).toArray();

    expect(rows).toHaveLength(1);
    const row = rows[0] as unknown as { dates: Temporal.Instant[] };
    expect(row.dates).toHaveLength(2);
    expect(row.dates[0]).toBeInstanceOf(Temporal.Instant);
    expect(row.dates.map((d) => d.toString())).toEqual(dates.map((d) => d.toString()));
  });

  it('round-trips Bytes[] with per-element codec fidelity', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    const bytes = [new Uint8Array([1, 2, 3]), new Uint8Array([255, 0, 127])];

    await runtime!
      .query(
        planFromAst(
          buildInsertAst({ id: 200, dates: null, bytes, decimals: null, bigints: null }),
          contract,
        ),
      )
      .toArray();

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(200), contract)).toArray();

    expect(rows).toHaveLength(1);
    const row = rows[0] as unknown as { bytes: Uint8Array[] };
    expect(row.bytes).toHaveLength(2);
    expect(row.bytes[0]).toBeInstanceOf(Uint8Array);
    expect([...(row.bytes[0] as Uint8Array)]).toEqual([1, 2, 3]);
    expect([...(row.bytes[1] as Uint8Array)]).toEqual([255, 0, 127]);
  });

  it('round-trips Decimal[] with per-element codec fidelity', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    // The Postgres driver returns numeric[] as raw array text; target framing
    // hands each element's raw text to PgNumericCodec.decode. This fixture uses
    // bare numeric storage, so Postgres does not scale-pad the decimal text.
    const decimals = ['1.5', '999999999999.99', '-0.001'];

    await runtime!
      .query(
        planFromAst(
          buildInsertAst({ id: 300, dates: null, bytes: null, decimals, bigints: null }),
          contract,
        ),
      )
      .toArray();

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(300), contract)).toArray();

    expect(rows).toHaveLength(1);
    const row = rows[0] as unknown as { decimals: string[] };
    expect(row.decimals).toHaveLength(3);
    expect(row.decimals[0]).toBe('1.5');
    expect(row.decimals[1]).toBe('999999999999.99');
    expect(row.decimals[2]).toBe('-0.001');
  });

  it('round-trips BigInt[] with per-element codec fidelity', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    // int8 spans the full signed 64-bit range, so the element codec carries
    // application values as `bigint` and reads the decimal string `pg` returns
    // for each element.
    const bigints = [12345678n, 9876543n];

    await runtime!
      .query(
        planFromAst(
          buildInsertAst({ id: 400, dates: null, bytes: null, decimals: null, bigints }),
          contract,
        ),
      )
      .toArray();

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(400), contract)).toArray();

    expect(rows).toHaveLength(1);
    const row = rows[0] as unknown as { bigints: bigint[] };
    expect(row.bigints).toHaveLength(2);
    expect(row.bigints[0]).toBe(12345678n);
    expect(row.bigints[1]).toBe(9876543n);
  });

  it('round-trips bool/int2/int4/float list values through raw array text decoding', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    const expected = {
      id: 450,
      dates: null,
      bytes: null,
      decimals: null,
      bigints: null,
      bools: [true, false, true],
      shorts: [-32768, 0, 32767],
      ints: [-2147483648, 0, 2147483647],
      singles: [1.25, -2.5],
      doubles: [3.5, -4.75],
    };

    await runtime!.query(planFromAst(buildInsertAst(expected), contract)).toArray();

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(450), contract)).toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expected);
  });

  it('passes NULL elements through the decode loop unchanged', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = getContract();

    // Insert a row with a NULL element via the driver directly so the test
    // exercises the decode-side NULL tolerance independent of encode.
    await runtime!
      .query(
        planFromAst(
          buildInsertAst({ id: 500, dates: null, bytes: null, decimals: null, bigints: null }),
          contract,
        ),
      )
      .toArray();

    // Override the bigints column directly with a NULL element after insert
    // by using the driver's raw query interface.
    // The 'has' operation is not available in the runtime yet (slice-3),
    // so we insert a row with bigints = null, then update it directly.
    // Simpler: use INSERT with literal SQL to bypass the codec path.
    // We need the runtime's driver — use a separate withClient for the raw insert.
    await withClient(database!.connectionString, async (client) => {
      await client.query(
        `INSERT INTO "ListTest" (id, bigints) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET bigints = $2`,
        [501, [1, null, 3]],
      );
    });

    const rows = await runtime!.query(planFromAst(buildSelectByIdAst(501), contract)).toArray();

    expect(rows).toHaveLength(1);
    // Elements decode through the int8 codec to `bigint`; null elements stay null.
    const row = rows[0] as unknown as { bigints: (bigint | null)[] };
    expect(row.bigints).toHaveLength(3);
    expect(row.bigints[0]).toBe(1n);
    expect(row.bigints[1]).toBeNull();
    expect(row.bigints[2]).toBe(3n);
  });
});

// ---------------------------------------------------------------------------
// Decode-path: malformed many-element → RUNTIME.DECODE_FAILED envelope
// ---------------------------------------------------------------------------
// This suite exercises the element-level error-wrap path in decoding.ts directly
// (via the exported test helpers) so the assertion does not depend on inserting
// intentionally-corrupt wire data into Postgres. The production many-decode loop
// in decoding.ts wraps every non-runtimeError element failure in DECODE_FAILED;
// this test proves that contract without requiring a real DB fixture.

describe('scalar-list decode — malformed element surfaces RUNTIME.DECODE_FAILED', () => {
  it('wraps an element-level decode failure in RUNTIME.DECODE_FAILED with column/codec context', async () => {
    const codec = defineTestCodec({
      typeId: 'test/strict-string@1',
      encode: (v: string) => v,
      decode: (wire: unknown) => {
        if (typeof wire !== 'string') {
          throw new Error(`expected string, got ${typeof wire}`);
        }
        return wire;
      },
      encodeJson: (v: string) => v,
      decodeJson: (json) => String(json),
    });
    const registry = buildTestContractCodecs([codec]);

    const ast = SelectAst.from(TABLE).withProjection([
      ProjectionItem.of('tags', ColumnRef.of('ListTest', 'tags'), {
        codecId: 'test/strict-string@1',
        many: true,
      }),
    ]);

    const ctx = buildDecodeContext(ast, registry);

    // Third element is a number — should trigger the element-level decode failure path.
    await expect(
      decodeRow({ tags: ['ok', 'also-ok', 42] }, ctx, {}, nativeArrayListDecoder),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({
        table: 'ListTest',
        column: 'tags',
        codec: 'test/strict-string@1',
      }),
    });
  });
});
