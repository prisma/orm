/**
 * Measures what the PostgreSQL target's aggregate defaults policy reads back
 * from a live database.
 *
 * The bare operations answer in the type a JS developer expects — `count`,
 * `sum`, and `avg` over integers are a `number` — and throw through the codec's
 * safe-range guard where a value cannot be one. The lossless variants
 * `countBigInt`, `sumBigInt`, and `avgDecimal` answer exactly, at any magnitude
 * PostgreSQL computes. The sibling conformance suite measures the declared
 * result *types* against the database; this one measures the *values*, since a
 * row that types correctly and rounds silently would pass there.
 *
 * Each case builds the SQL from the row's own lowering, so what runs is what a
 * query would run.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import type { Codec } from '@internal/framework-components/codec';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { postgresAggregateDescriptors } from '@internal/target-postgres/aggregates';
import {
  postgresCodecDescriptorRegistry,
  postgresCodecRegistry,
} from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateSql } from './aggregate-sql';

const registry = buildSqlAggregateDescriptorRegistry(
  postgresAggregateDescriptors,
  postgresCodecRegistry,
);

const TABLE = 'aggregate_defaults';
const COLUMN = 'value';

/** 2^53 − 1, the largest integer a JS `number` holds exactly, and the boundary the number-flavoured codecs guard. */
const MAX_SAFE = 9007199254740991n;

/** The codec a resolved row decodes its result through, instantiated as the runtime would. */
function codecFor(codecId: string): Codec {
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)!.factory(undefined)({
    name: 'aggregate-defaults',
  });
}

function nativeTypeOf(codecId: string): string {
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)!.nativeTypeFor({ codecId });
}

describe('PostgreSQL aggregate defaults', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let query: (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
    query = async (sql) => (await driver!.query(sql, [])).rows;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  /** A one-column table of the codec's native type, loaded with the given literals. */
  async function withColumnOf(
    codecId: string,
    samples: readonly string[],
    body: () => Promise<void>,
  ): Promise<void> {
    const nativeType = nativeTypeOf(codecId);
    await query(`DROP TABLE IF EXISTS "${TABLE}"`);
    await query(`CREATE TABLE "${TABLE}" ("${COLUMN}" ${nativeType})`);
    for (const sample of samples) {
      await query(`INSERT INTO "${TABLE}" ("${COLUMN}") VALUES ((${sample})::${nativeType})`);
    }
    await body();
  }

  /** Runs the aggregate `operation` resolves to over the loaded column, and hands back its wire value and the codec that reads it. */
  async function aggregate(
    operation: string,
    inputCodecId: string | undefined,
  ): Promise<{ wire: unknown; codec: Codec; codecId: string }> {
    const inputCodec = inputCodecId === undefined ? undefined : { codecId: inputCodecId };
    const resolved = registry.resolve(operation, inputCodec)!;
    const expression = aggregateSql({
      operation,
      lower: resolved.lower,
      inputCodec,
      table: TABLE,
      column: inputCodecId === undefined ? undefined : COLUMN,
    });
    const rows = await query(`SELECT ${expression} AS result FROM "${TABLE}"`);
    return {
      wire: rows[0]?.['result'],
      codec: codecFor(resolved.output.codecId),
      codecId: resolved.output.codecId,
    };
  }

  it('resolves the defaults policy row by row', () => {
    const output = (operation: string, codecId?: string): string | undefined =>
      registry.resolve(operation, codecId === undefined ? undefined : { codecId })?.output.codecId;

    expect({
      'count()': output('count'),
      'count(pg/text@1)': output('count', 'pg/text@1'),
      'countBigInt()': output('countBigInt'),
      'countBigInt(pg/text@1)': output('countBigInt', 'pg/text@1'),
      'sum(pg/int2@1)': output('sum', 'pg/int2@1'),
      'sum(pg/int4@1)': output('sum', 'pg/int4@1'),
      'sum(pg/int8@1)': output('sum', 'pg/int8@1'),
      'sum(pg/int8number@1)': output('sum', 'pg/int8number@1'),
      'sum(pg/unboundedint@1)': output('sum', 'pg/unboundedint@1'),
      'sum(pg/numeric@1)': output('sum', 'pg/numeric@1'),
      'sum(pg/float4@1)': output('sum', 'pg/float4@1'),
      'sum(pg/float8@1)': output('sum', 'pg/float8@1'),
      'sum(pg/interval@1)': output('sum', 'pg/interval@1'),
      'sumBigInt(pg/int2@1)': output('sumBigInt', 'pg/int2@1'),
      'sumBigInt(pg/int4@1)': output('sumBigInt', 'pg/int4@1'),
      'sumBigInt(pg/int8@1)': output('sumBigInt', 'pg/int8@1'),
      'sumBigInt(pg/int8number@1)': output('sumBigInt', 'pg/int8number@1'),
      'sumBigInt(pg/unboundedint@1)': output('sumBigInt', 'pg/unboundedint@1'),
      'avg(pg/int4@1)': output('avg', 'pg/int4@1'),
      'avg(pg/int8@1)': output('avg', 'pg/int8@1'),
      'avg(pg/int8number@1)': output('avg', 'pg/int8number@1'),
      'avg(pg/unboundedint@1)': output('avg', 'pg/unboundedint@1'),
      'avg(pg/numeric@1)': output('avg', 'pg/numeric@1'),
      'avg(pg/float4@1)': output('avg', 'pg/float4@1'),
      'avg(pg/interval@1)': output('avg', 'pg/interval@1'),
      'avgDecimal(pg/int4@1)': output('avgDecimal', 'pg/int4@1'),
      'avgDecimal(pg/int8@1)': output('avgDecimal', 'pg/int8@1'),
      'avgDecimal(pg/unboundedint@1)': output('avgDecimal', 'pg/unboundedint@1'),
      'avgDecimal(pg/numeric@1)': output('avgDecimal', 'pg/numeric@1'),
      'min(pg/int4@1)': output('min', 'pg/int4@1'),
      'max(pg/int8number@1)': output('max', 'pg/int8number@1'),
    }).toEqual({
      'count()': 'pg/int8number@1',
      'count(pg/text@1)': 'pg/int8number@1',
      'countBigInt()': 'pg/int8@1',
      'countBigInt(pg/text@1)': 'pg/int8@1',
      'sum(pg/int2@1)': 'pg/int8number@1',
      'sum(pg/int4@1)': 'pg/int8number@1',
      'sum(pg/int8@1)': 'pg/int8number@1',
      'sum(pg/int8number@1)': 'pg/int8number@1',
      'sum(pg/unboundedint@1)': 'pg/unboundedint@1',
      'sum(pg/numeric@1)': 'pg/numeric@1',
      'sum(pg/float4@1)': 'pg/float4@1',
      'sum(pg/float8@1)': 'pg/float8@1',
      'sum(pg/interval@1)': 'pg/interval@1',
      'sumBigInt(pg/int2@1)': 'pg/int8@1',
      'sumBigInt(pg/int4@1)': 'pg/int8@1',
      'sumBigInt(pg/int8@1)': 'pg/unboundedint@1',
      'sumBigInt(pg/int8number@1)': 'pg/unboundedint@1',
      'sumBigInt(pg/unboundedint@1)': 'pg/unboundedint@1',
      'avg(pg/int4@1)': 'pg/float8@1',
      'avg(pg/int8@1)': 'pg/float8@1',
      'avg(pg/int8number@1)': 'pg/float8@1',
      'avg(pg/unboundedint@1)': 'pg/float8@1',
      'avg(pg/numeric@1)': 'pg/numeric@1',
      'avg(pg/float4@1)': 'pg/float8@1',
      'avg(pg/interval@1)': 'pg/interval@1',
      'avgDecimal(pg/int4@1)': 'pg/numeric@1',
      'avgDecimal(pg/int8@1)': 'pg/numeric@1',
      'avgDecimal(pg/unboundedint@1)': 'pg/numeric@1',
      'avgDecimal(pg/numeric@1)': 'pg/numeric@1',
      'min(pg/int4@1)': 'pg/int4@1',
      'max(pg/int8number@1)': 'pg/int8number@1',
    });
  });

  it(
    'counts as a number, and as a bigint through countBigInt',
    async () => {
      await withColumnOf('pg/int8@1', ['1', '2'], async () => {
        const overRows = await aggregate('count', undefined);
        const overRowsLossless = await aggregate('countBigInt', undefined);
        const overValues = await aggregate('count', 'pg/int8@1');

        expect({
          count: await overRows.codec.decode(overRows.wire, {}),
          countBigInt: await overRowsLossless.codec.decode(overRowsLossless.wire, {}),
          countOverValues: await overValues.codec.decode(overValues.wire, {}),
        }).toEqual({ count: 2, countBigInt: 2n, countOverValues: 2 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'sums 64-bit integers up to the safe-integer boundary and refuses the total past it',
    async () => {
      // 2^53 − 1 in two rows: the largest total a `number` carries exactly.
      await withColumnOf('pg/int8@1', ['4503599627370495', '4503599627370496'], async () => {
        const { wire, codec } = await aggregate('sum', 'pg/int8@1');

        expect(wire).toBe(MAX_SAFE.toString());
        expect(await codec.decode(wire, {})).toBe(9007199254740991);
      });

      // One row more, and the total is 2^53: representable as a double, outside
      // the range where every integer is.
      await withColumnOf('pg/int8@1', ['4503599627370496', '4503599627370496'], async () => {
        const { wire, codec } = await aggregate('sum', 'pg/int8@1');

        expect(wire).toBe((MAX_SAFE + 1n).toString());
        expect(() => codec.decode(wire, {})).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.DECODE_FAILED',
            message:
              'pg/int8number@1 value must be an integer within the safe integer range, got 9007199254740992',
            meta: { codecId: 'pg/int8number@1', received: '9007199254740992' },
          }),
        );
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'sums the same 64-bit integers past 2^63 exactly through sumBigInt',
    async () => {
      await withColumnOf('pg/int8@1', ['9223372036854775807', '9223372036854775807'], async () => {
        const { wire, codec, codecId } = await aggregate('sumBigInt', 'pg/int8@1');

        expect(codecId).toBe('pg/unboundedint@1');
        expect(wire).toBe('18446744073709551614');
        expect(await codec.decode(wire, {})).toBe(18446744073709551614n);

        // The cast this row does not take: PostgreSQL computes the total as a
        // `numeric`, and reading it back as an `int8` fails where the
        // unbounded decode above succeeds.
        await expect(
          query(`SELECT sum("${COLUMN}")::int8 AS result FROM "${TABLE}"`),
        ).rejects.toThrow('bigint out of range');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'sums small integers into a bigint through sumBigInt, where the database already produces one',
    async () => {
      await withColumnOf('pg/int4@1', ['2147483647', '2147483647'], async () => {
        const bare = await aggregate('sum', 'pg/int4@1');
        const lossless = await aggregate('sumBigInt', 'pg/int4@1');

        expect({
          sum: await bare.codec.decode(bare.wire, {}),
          sumBigInt: await lossless.codec.decode(lossless.wire, {}),
          losslessCodec: lossless.codecId,
        }).toEqual({ sum: 4294967294, sumBigInt: 4294967294n, losslessCodec: 'pg/int8@1' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'sums the unbounded integer through sumBigInt as well, where the bare sum is already exact',
    async () => {
      // Past 2^63 on a column whose own `sum` PostgreSQL computes exactly: the
      // two forms answer with the same value, which is what makes the suffix an
      // escape hatch a caller can reach for over any integer column.
      await withColumnOf(
        'pg/unboundedint@1',
        ['9223372036854775807', '9223372036854775807'],
        async () => {
          const bare = await aggregate('sum', 'pg/unboundedint@1');
          const lossless = await aggregate('sumBigInt', 'pg/unboundedint@1');

          expect({
            sum: await bare.codec.decode(bare.wire, {}),
            sumBigInt: await lossless.codec.decode(lossless.wire, {}),
            losslessCodec: lossless.codecId,
          }).toEqual({
            sum: 18446744073709551614n,
            sumBigInt: 18446744073709551614n,
            losslessCodec: 'pg/unboundedint@1',
          });
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'averages integers as a number, and exactly through avgDecimal',
    async () => {
      // 31/3 has no finite binary expansion, so the rounded mean and the exact
      // one are different values — a mean that terminated would pass whichever
      // the row declared.
      await withColumnOf('pg/int8@1', ['10', '10', '11'], async () => {
        const bare = await aggregate('avg', 'pg/int8@1');
        const exact = await aggregate('avgDecimal', 'pg/int8@1');

        const mean = await bare.codec.decode(bare.wire, {});
        const exactMean = await exact.codec.decode(exact.wire, {});

        expect({ mean, exactMean }).toEqual({
          mean: 10.333333333333334,
          exactMean: '10.3333333333333333',
        });
        expect(String(mean)).not.toBe(exactMean);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'averages the unbounded integer as a number too, with avgDecimal as its exact form',
    async () => {
      await withColumnOf('pg/unboundedint@1', ['10', '10', '11'], async () => {
        const bare = await aggregate('avg', 'pg/unboundedint@1');
        const exact = await aggregate('avgDecimal', 'pg/unboundedint@1');

        expect({
          mean: await bare.codec.decode(bare.wire, {}),
          meanCodec: bare.codecId,
          exactMean: await exact.codec.decode(exact.wire, {}),
          exactCodec: exact.codecId,
        }).toEqual({
          mean: 10.333333333333334,
          meanCodec: 'pg/float8@1',
          exactMean: '10.3333333333333333',
          exactCodec: 'pg/numeric@1',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'casts the result of an integer average, not its input',
    async () => {
      const resolved = registry.resolve('avg', { codecId: 'pg/int8@1' })!;

      expect(
        aggregateSql({
          operation: 'avg',
          lower: resolved.lower,
          inputCodec: { codecId: 'pg/int8@1' },
          table: TABLE,
          column: COLUMN,
        }),
      ).toBe(`CAST(avg("${TABLE}"."${COLUMN}") AS float8)`);

      // A mean a `double precision` holds exactly, over a value it does not:
      // rounding once at the end lands on it, while rounding each input first
      // loses the odd bit before the division happens at all.
      await withColumnOf('pg/int8@1', ['9007199254740993', '1'], async () => {
        const { wire, codec } = await aggregate('avg', 'pg/int8@1');
        const [row] = await query(
          `SELECT avg(CAST("${COLUMN}" AS float8)) AS input_cast FROM "${TABLE}"`,
        );

        expect({
          resultCast: await codec.decode(wire, {}),
          inputCast: row?.['input_cast'],
        }).toEqual({ resultCast: 4503599627370497, inputCast: 4503599627370496 });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
