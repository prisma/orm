/**
 * Measures what the SQLite target's aggregate defaults policy reads back from a
 * live database.
 *
 * The bare operations answer in the type a JS developer expects — `count` and
 * `sum` over integers are a `number`, `avg` is the `real` SQLite computes — and
 * throw through the codec's safe-range guard where a value cannot be one. The
 * lossless variants `countBigInt` and `sumBigInt` answer exactly, up to the
 * 64-bit total SQLite's own `SUM` refuses to exceed. The sibling conformance
 * suite measures the declared result *classes* against the database; this one
 * measures the *values*, since a row that types correctly and rounds silently
 * would pass there.
 *
 * Each case builds the SQL from the row's own lowering, so what runs is what a
 * query would run.
 */

import { DatabaseSync } from 'node:sqlite';
import type { Codec } from '@internal/framework-components/codec';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { AggregateExpr, CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { sqliteAggregateDescriptors } from '@internal/target-sqlite/aggregates';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateSql } from './aggregate-sql';

const registry = buildSqlAggregateDescriptorRegistry(
  sqliteAggregateDescriptors,
  sqliteCodecRegistry,
);

const TABLE = 'aggregate_defaults';
const COLUMN = 'value';

/** 2^53 − 1, the largest integer a JS `number` holds exactly, and the boundary the number-flavoured codec guards. */
const MAX_SAFE = 9007199254740991n;

/** The largest total SQLite's `SUM` produces: one row more raises `integer overflow`, which is the bound `sumBigInt` is offered within. */
const MAX_INT64 = 9223372036854775807n;

/** The result codecs carrying an integer wider than the driver's numeric reads, and so the ones a lowering has to cast out as text. */
const WIDE_INTEGER_CODEC_IDS: ReadonlyArray<string> = ['sqlite/bigint@1', 'sqlite/bigintnumber@1'];

/** The codec a resolved row decodes its result through, instantiated as the runtime would. */
function codecFor(codecId: string): Codec {
  return sqliteCodecRegistry.descriptorFor(codecId)!.factory(undefined)({
    name: 'aggregate-defaults',
  });
}

describe('SQLite aggregate defaults', { concurrent: false }, () => {
  let database: DatabaseSync | undefined;

  beforeAll(() => {
    database = new DatabaseSync(':memory:');
  });

  afterAll(() => {
    database?.close();
    database = undefined;
  });

  const run = (sql: string): ReadonlyArray<Record<string, unknown>> =>
    database!.prepare(sql).all() as ReadonlyArray<Record<string, unknown>>;

  /** A one-column INTEGER table loaded with the given literals — the storage every integer codec here shares. */
  function loadIntegerColumn(samples: readonly string[]): void {
    run(`DROP TABLE IF EXISTS "${TABLE}"`);
    run(`CREATE TABLE "${TABLE}" ("${COLUMN}" INTEGER)`);
    for (const sample of samples) {
      run(`INSERT INTO "${TABLE}" ("${COLUMN}") VALUES (${sample})`);
    }
  }

  /** Runs the aggregate `operation` resolves to over the loaded column, and hands back its wire value and the codec that reads it. */
  function aggregate(
    operation: string,
    inputCodecId: string | undefined,
  ): { wire: unknown; codec: Codec; codecId: string } {
    const inputCodec = inputCodecId === undefined ? undefined : { codecId: inputCodecId };
    const resolved = registry.resolve(operation, inputCodec)!;
    const expression = aggregateSql({
      operation,
      lower: resolved.lower,
      inputCodec,
      table: TABLE,
      column: inputCodecId === undefined ? undefined : COLUMN,
    });
    return {
      wire: run(`SELECT ${expression} AS result FROM "${TABLE}"`)[0]?.['result'],
      codec: codecFor(resolved.output.codecId),
      codecId: resolved.output.codecId,
    };
  }

  it('resolves the defaults policy row by row', () => {
    const output = (operation: string, codecId?: string): string | undefined =>
      registry.resolve(operation, codecId === undefined ? undefined : { codecId })?.output.codecId;

    expect({
      'count()': output('count'),
      'countBigInt()': output('countBigInt'),
      'sum(sqlite/integer@1)': output('sum', 'sqlite/integer@1'),
      'sum(sqlite/bigint@1)': output('sum', 'sqlite/bigint@1'),
      'sum(sqlite/bigintnumber@1)': output('sum', 'sqlite/bigintnumber@1'),
      'sum(sql/int@1)': output('sum', 'sql/int@1'),
      'sum(sqlite/real@1)': output('sum', 'sqlite/real@1'),
      'sumBigInt(sqlite/integer@1)': output('sumBigInt', 'sqlite/integer@1'),
      'sumBigInt(sqlite/bigint@1)': output('sumBigInt', 'sqlite/bigint@1'),
      'sumBigInt(sqlite/bigintnumber@1)': output('sumBigInt', 'sqlite/bigintnumber@1'),
      'sumBigInt(sqlite/real@1)': output('sumBigInt', 'sqlite/real@1'),
      'avg(sqlite/integer@1)': output('avg', 'sqlite/integer@1'),
      'avg(sqlite/bigint@1)': output('avg', 'sqlite/bigint@1'),
      'avg(sqlite/bigintnumber@1)': output('avg', 'sqlite/bigintnumber@1'),
      'avg(sqlite/real@1)': output('avg', 'sqlite/real@1'),
      'min(sqlite/integer@1)': output('min', 'sqlite/integer@1'),
      'max(sqlite/bigint@1)': output('max', 'sqlite/bigint@1'),
    }).toEqual({
      'count()': 'sqlite/bigintnumber@1',
      'countBigInt()': 'sqlite/bigint@1',
      'sum(sqlite/integer@1)': 'sqlite/bigintnumber@1',
      'sum(sqlite/bigint@1)': 'sqlite/bigintnumber@1',
      'sum(sqlite/bigintnumber@1)': 'sqlite/bigintnumber@1',
      'sum(sql/int@1)': 'sqlite/bigintnumber@1',
      'sum(sqlite/real@1)': 'sqlite/real@1',
      'sumBigInt(sqlite/integer@1)': 'sqlite/bigint@1',
      'sumBigInt(sqlite/bigint@1)': 'sqlite/bigint@1',
      'sumBigInt(sqlite/bigintnumber@1)': 'sqlite/bigint@1',
      'sumBigInt(sqlite/real@1)': undefined,
      'avg(sqlite/integer@1)': 'sqlite/real@1',
      'avg(sqlite/bigint@1)': 'sqlite/real@1',
      'avg(sqlite/bigintnumber@1)': 'sqlite/real@1',
      'avg(sqlite/real@1)': 'sqlite/real@1',
      'min(sqlite/integer@1)': 'sqlite/integer@1',
      'max(sqlite/bigint@1)': 'sqlite/bigint@1',
    });
  });

  it('counts as a number, and as a bigint through countBigInt', async () => {
    loadIntegerColumn(['1', '2']);

    const overRows = aggregate('count', undefined);
    const overRowsLossless = aggregate('countBigInt', undefined);
    const overValues = aggregate('count', 'sqlite/integer@1');

    expect({
      count: await overRows.codec.decode(overRows.wire, {}),
      countBigInt: await overRowsLossless.codec.decode(overRowsLossless.wire, {}),
      countOverValues: await overValues.codec.decode(overValues.wire, {}),
    }).toEqual({ count: 2, countBigInt: 2n, countOverValues: 2 });
  });

  it('counts an empty set as zero rather than null', async () => {
    loadIntegerColumn([]);

    const { wire, codec } = aggregate('count', undefined);

    expect(await codec.decode(wire, {})).toBe(0);
  });

  it('sums integers up to the safe-integer boundary and refuses the total past it', async () => {
    // 2^53 − 1 in two rows: the largest total a `number` carries exactly.
    loadIntegerColumn(['4503599627370495', '4503599627370496']);
    const withinRange = aggregate('sum', 'sqlite/integer@1');

    expect(withinRange.wire).toBe(MAX_SAFE.toString());
    expect(await withinRange.codec.decode(withinRange.wire, {})).toBe(9007199254740991);

    // One row more, and the total is 2^53: representable as a double, outside
    // the range where every integer is.
    loadIntegerColumn(['4503599627370496', '4503599627370496']);
    const pastRange = aggregate('sum', 'sqlite/integer@1');

    expect(pastRange.wire).toBe((MAX_SAFE + 1n).toString());
    expect(() => pastRange.codec.decode(pastRange.wire, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'sqlite/bigintnumber@1 value must be an integer within the safe integer range, got 9007199254740992',
        meta: { codecId: 'sqlite/bigintnumber@1', received: '9007199254740992' },
      }),
    );
  });

  it('sums the same integers past 2^53 exactly through sumBigInt', async () => {
    const total = 9007199254740995n;
    loadIntegerColumn(['9007199254740993', '2']);

    const { wire, codec, codecId } = aggregate('sumBigInt', 'sqlite/integer@1');

    expect(codecId).toBe('sqlite/bigint@1');
    expect(wire).toBe(total.toString());
    expect(await codec.decode(wire, {})).toBe(total);
    // A total a double does not hold, so an exact read and a rounded one differ.
    expect(BigInt(Number(total))).not.toBe(total);
  });

  it('sums a bigint column through sumBigInt up to the 64-bit total SQLite computes', async () => {
    loadIntegerColumn([MAX_INT64.toString(), '0']);
    const { wire, codec } = aggregate('sumBigInt', 'sqlite/bigint@1');

    expect(await codec.decode(wire, {})).toBe(MAX_INT64);

    // One more, and SQLite refuses to compute the total at all rather than
    // promoting it to a float. That raise is the target's declared bound: the
    // row is offered within it, not around it.
    loadIntegerColumn([MAX_INT64.toString(), '1']);
    expect(() => aggregate('sumBigInt', 'sqlite/bigint@1')).toThrow(/integer overflow/);
  });

  it('averages integers as a number, SQLite computing the mean as a real', async () => {
    // 31/3 has no finite binary expansion, so a mean that terminated would pass
    // whichever form the row declared.
    loadIntegerColumn(['10', '10', '11']);

    const { wire, codec, codecId } = aggregate('avg', 'sqlite/integer@1');

    expect(codecId).toBe('sqlite/real@1');
    expect(await codec.decode(wire, {})).toBe(10.333333333333334);
  });

  // A wide integer result leaves the database as text, because `node:sqlite`
  // reads an integer no JS number can hold as an error rather than a value. The
  // lowering is what renders the cast — and it renders only that: the codec the
  // descriptor declared is still the codec the registry resolves.
  describe('integer results are lowered to text', () => {
    it('lowers every reachable wide-integer result but a BigIntNumber column extremum', () => {
      const inputs: ReadonlyArray<string | undefined> = [
        undefined,
        ...[...sqliteCodecRegistry.values()].map((descriptor) => descriptor.codecId),
      ];
      const operations = new Set([...registry.values()].map((row) => row.operation));

      const unlowered = [...operations].flatMap((operation) =>
        inputs.flatMap((codecId) => {
          const resolved = registry.resolve(
            operation,
            codecId === undefined ? undefined : { codecId },
          );
          if (resolved === undefined || resolved.lower !== undefined) return [];
          return WIDE_INTEGER_CODEC_IDS.includes(resolved.output.codecId)
            ? [`${operation}(${codecId ?? ''})`]
            : [];
        }),
      );

      // `min`/`max` over `sqlite/bigint@1` claim that codec exactly, so they
      // carry the cast. `sqlite/bigintnumber@1` has no such row: its extrema
      // match the `numeric`-trait row and output `self`, which reads the
      // extremum exactly the way a flat read of the column reads a value.
      expect([...unlowered].sort()).toEqual([
        'max(sqlite/bigintnumber@1)',
        'min(sqlite/bigintnumber@1)',
      ]);
    });

    it('builds a cast over the aggregate its row computes with, and nothing that names a codec', () => {
      const lowerings = ['count', 'countBigInt', 'sum', 'sumBigInt'].map((operation) => {
        const inputCodec = { codecId: 'sqlite/integer@1' };
        const resolved = registry.resolve(operation, inputCodec);
        return [
          operation,
          resolved?.lower?.({ expr: ColumnRef.of('t', 'c'), inputCodec }),
          resolved?.output.codecId,
        ];
      });

      expect(lowerings).toEqual([
        [
          'count',
          CastExpr.as(AggregateExpr.count(ColumnRef.of('t', 'c')), 'text'),
          'sqlite/bigintnumber@1',
        ],
        [
          'countBigInt',
          CastExpr.as(AggregateExpr.count(ColumnRef.of('t', 'c')), 'text'),
          'sqlite/bigint@1',
        ],
        [
          'sum',
          CastExpr.as(AggregateExpr.sum(ColumnRef.of('t', 'c')), 'text'),
          'sqlite/bigintnumber@1',
        ],
        [
          'sumBigInt',
          CastExpr.as(AggregateExpr.sum(ColumnRef.of('t', 'c')), 'text'),
          'sqlite/bigint@1',
        ],
      ]);
    });

    it('reads a sum past 2^53 back at all, where the uncast form cannot be read', () => {
      loadIntegerColumn(['9007199254740993']);

      expect(aggregate('sum', 'sqlite/integer@1').wire).toBe('9007199254740993');
      expect(() => run(`SELECT sum("${COLUMN}") AS result FROM "${TABLE}"`)).toThrow(/too large/);
    });
  });
});
