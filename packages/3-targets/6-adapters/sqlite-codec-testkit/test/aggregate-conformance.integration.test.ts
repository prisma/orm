/**
 * Measures the SQLite target's aggregate descriptors against the database they
 * describe.
 *
 * SQLite types values rather than columns, so what this suite compares is
 * storage classes: for every built-in codec and every built-in aggregate it
 * asks a live SQLite what `typeof()` the aggregate's result has, and requires
 * that to be the storage class of the codec the registry resolves. The question
 * is asked of the aggregate each row computes with — `countBigInt` computes
 * with `count` and `sumBigInt` with `sum` — and with the transport cast
 * stripped, that cast rendering a result rather than choosing one.
 *
 * The second half of the measurement is the pairs left unclaimed. SQLite has no
 * aggregate it refuses: `sum` and `avg` over `TEXT` or `BLOB` read a leading
 * number where there is one and 0 where there is not, so `sum` over a column of
 * words is `0.0`, `sum` over a column of numerals is their total, and the result
 * changes storage class with the rows. An aggregate whose result type cannot be
 * known from the schema is one this target declines to type, so those pairs
 * carry no descriptor — and the suite pins the list, so a pair cannot quietly
 * join or leave it. That measurement applies to the bare operations, whose SQL
 * call is the operation's own name; which inputs a lossless variant is offered
 * over is policy, and is pinned as such.
 *
 * The probed behaviours behind the `sum` declarations, on SQLite 3.53:
 *
 * - `sum` over integers stays an integer, and an overflow past 64 bits raises
 *   `integer overflow` rather than promoting to a float — so the result is an
 *   integer or it is an error, never a rounded double. That raise is the bound
 *   `sumBigInt` is offered within.
 * - That integer is free to exceed 2^53 (two rows of 9007199254740993 sum to
 *   9007199254740995), which is why the bare `sum` reads through
 *   `sqlite/bigintnumber@1`, whose guard refuses such a total rather than
 *   rounding it, and `sumBigInt` through `sqlite/bigint@1`, which carries it.
 * - `avg` is `real` for every input, integers included, so the bare `avg` is
 *   already the JS `number` the defaults policy asks for and has no lossless
 *   variant: SQLite has no exact decimal to answer one with.
 * - `min`/`max` return a value of the input's own storage class, blobs included.
 */

import { DatabaseSync } from 'node:sqlite';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { sqliteAggregateDescriptors } from '@internal/target-sqlite/aggregates';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computedAggregateSql } from './aggregate-sql';

const registry = buildSqlAggregateDescriptorRegistry(
  sqliteAggregateDescriptors,
  sqliteCodecRegistry,
);

/** The operations whose SQL call carries the operation's own name, and whose absence over a type SQLite aggregates is therefore a gap. */
const BARE_OPERATIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;

/** The lossless variants, each reading the result of the SQL aggregate its bare namesake computes. */
const LOSSLESS_OPERATIONS = ['countBigInt', 'sumBigInt'] as const;

const OPERATIONS = [...BARE_OPERATIONS, ...LOSSLESS_OPERATIONS];

/** Every operation the target contributes — `avgDecimal` among them would need an exact decimal result codec, which SQLite has none of. */
const CONTRIBUTED_OPERATIONS = [...BARE_OPERATIONS, ...LOSSLESS_OPERATIONS].sort();

/**
 * The inputs `sumBigInt` claims: every integer input, including those whose
 * bare `sum` the driver could already carry. The suffix is an escape hatch, and
 * one a caller should be able to reach for over any integer column without
 * learning which widths happen not to need it. `countBigInt` is input-agnostic
 * like `count`, so it claims every codec and appears in no list.
 */
const LOSSLESS_VARIANT_INPUTS: Readonly<Record<string, readonly string[]>> = {
  sumBigInt: ['sql/int@1', 'sqlite/bigint@1', 'sqlite/bigintnumber@1', 'sqlite/integer@1'],
};

/** The result codecs an integer total reads through, whichever form is asked for. Membership of this set is what makes an input an integer one. */
const INTEGER_RESULT_CODEC_IDS = ['sqlite/bigint@1', 'sqlite/bigintnumber@1'];

interface AggregateFixture {
  readonly codecId: string;
  /** SQLite column type the target stores this codec in. */
  readonly storageType: string;
  /** `typeof()` of a value stored through this codec — the class its aggregates are measured against. */
  readonly storageClass: 'integer' | 'real' | 'text' | 'blob';
  /** Two SQL literals of that storage class, so every aggregate has something to fold. */
  readonly samples: readonly [string, string];
}

/** One fixture per built-in codec — enforced by a test below, so a codec added to the target cannot skip the matrix. */
const FIXTURES: readonly AggregateFixture[] = [
  {
    codecId: 'sql/char@1',
    storageType: 'TEXT',
    storageClass: 'text',
    samples: ["'a'", "'b'"],
  },
  {
    codecId: 'sql/varchar@1',
    storageType: 'TEXT',
    storageClass: 'text',
    samples: ["'a'", "'b'"],
  },
  { codecId: 'sql/int@1', storageType: 'INTEGER', storageClass: 'integer', samples: ['1', '2'] },
  { codecId: 'sql/float@1', storageType: 'REAL', storageClass: 'real', samples: ['1.5', '2.5'] },
  { codecId: 'sqlite/text@1', storageType: 'TEXT', storageClass: 'text', samples: ["'a'", "'b'"] },
  {
    codecId: 'sqlite/integer@1',
    storageType: 'INTEGER',
    storageClass: 'integer',
    samples: ['1', '2'],
  },
  { codecId: 'sqlite/real@1', storageType: 'REAL', storageClass: 'real', samples: ['1.5', '2.5'] },
  {
    codecId: 'sqlite/blob@1',
    storageType: 'BLOB',
    storageClass: 'blob',
    samples: ["x'01'", "x'02'"],
  },
  {
    codecId: 'sqlite/datetime@1',
    storageType: 'TEXT',
    storageClass: 'text',
    samples: ["'2024-01-01T10:00:00.000Z'", "'2024-02-01T10:00:00.000Z'"],
  },
  {
    codecId: 'sqlite/json@1',
    storageType: 'TEXT',
    storageClass: 'text',
    samples: ['\'{"a":1}\'', '\'{"b":2}\''],
  },
  {
    codecId: 'sqlite/bigint@1',
    storageType: 'INTEGER',
    storageClass: 'integer',
    samples: ['9007199254740993', '2'],
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    storageType: 'INTEGER',
    storageClass: 'integer',
    samples: ['1', '2'],
  },
  {
    codecId: 'sql/raw@1',
    storageType: 'geometry',
    storageClass: 'blob',
    samples: ["x'01'", "x'02'"],
  },
];

/**
 * The pairs SQLite computes and this target declines to type: `sum` and `avg`
 * over every non-numeric codec, whose result is whatever leading numbers the
 * stored text or blob happens to contain.
 */
const COERCED_RATHER_THAN_TYPED = [
  'avg(sql/char@1)',
  'avg(sql/raw@1)',
  'avg(sql/varchar@1)',
  'avg(sqlite/blob@1)',
  'avg(sqlite/datetime@1)',
  'avg(sqlite/json@1)',
  'avg(sqlite/text@1)',
  'sum(sql/char@1)',
  'sum(sql/raw@1)',
  'sum(sql/varchar@1)',
  'sum(sqlite/blob@1)',
  'sum(sqlite/datetime@1)',
  'sum(sqlite/json@1)',
  'sum(sqlite/text@1)',
];

/**
 * The pairs SQLite computes and this target declines to offer because the codec declares no
 * `order` trait: a raw column's values are not interpreted, so the ORM offers no extremum of them
 * (ADR 273).
 */
const UNORDERED = ['max(sql/raw@1)', 'min(sql/raw@1)'];

const TABLE = 'aggregate_conformance';
const COLUMN = 'value';

function storageClassOf(codecId: string): string {
  const fixture = FIXTURES.find((entry) => entry.codecId === codecId);
  if (fixture === undefined) {
    throw new Error(`No aggregate fixture for '${codecId}'.`);
  }
  return fixture.storageClass;
}

/** The codecs the bare `sum` totals into an integer result — the integer inputs, read off the matrix rather than listed beside it. */
function integerInputs(): readonly string[] {
  return FIXTURES.map((fixture) => fixture.codecId).filter((codecId) => {
    const resolved = registry.resolve('sum', { codecId });
    return resolved !== undefined && INTEGER_RESULT_CODEC_IDS.includes(resolved.output.codecId);
  });
}

describe('SQLite aggregate conformance', { concurrent: false }, () => {
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

  function withFixtureTable<T>(fixture: AggregateFixture, body: () => T): T {
    run(`DROP TABLE IF EXISTS "${TABLE}"`);
    run(`CREATE TABLE "${TABLE}" ("${COLUMN}" ${fixture.storageType})`);
    for (const sample of fixture.samples) {
      run(`INSERT INTO "${TABLE}" ("${COLUMN}") VALUES (${sample})`);
    }
    return body();
  }

  /**
   * The messages `node:sqlite` raises for a call SQLite refuses outright: an
   * aggregate it does not have, or one invoked with a shape it rejects. Probed
   * empirically — every SQLite error carries the same `ERR_SQLITE_ERROR` code
   * (`no such table` and `integer overflow` included), so the message is the
   * only thing that separates refusal from infrastructure failure.
   */
  const REFUSED_CALL =
    /^(no such function|wrong number of arguments to function|misuse of aggregate)/;

  /**
   * The storage class SQLite gives the expression, or `undefined` when it
   * refuses the call. Anything else — a missing table, an overflow, a locked
   * database — is rethrown rather than read as refusal: in the unclaimed
   * direction a swallowed infrastructure error would pass the matrix
   * vacuously.
   */
  function probeStorageClass(expression: string): string | undefined {
    try {
      const rows = run(`SELECT typeof(${expression}) AS result FROM "${TABLE}"`);
      return String(rows[0]?.['result']);
    } catch (error) {
      if (error instanceof Error && REFUSED_CALL.test(error.message)) return undefined;
      throw error;
    }
  }

  it('covers every built-in codec', () => {
    const fixtured = new Set(FIXTURES.map((fixture) => fixture.codecId));
    const uncovered = [...sqliteCodecRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !fixtured.has(codecId));

    expect(uncovered).toEqual([]);
  });

  it('declares the storage class SQLite produces, for every aggregate it declares', () => {
    const disagreements: unknown[] = [];

    for (const fixture of FIXTURES) {
      withFixtureTable(fixture, () => {
        for (const operation of OPERATIONS) {
          const inputCodec = { codecId: fixture.codecId };
          const resolved = registry.resolve(operation, inputCodec);
          if (resolved === undefined) continue;

          const actual = probeStorageClass(
            computedAggregateSql({
              operation,
              lower: resolved.lower,
              inputCodec,
              table: TABLE,
              column: COLUMN,
            }),
          );
          const declared = storageClassOf(resolved.output.codecId);
          if (actual !== declared) {
            disagreements.push({
              operation,
              codecId: fixture.codecId,
              declared: `${resolved.output.codecId} (${declared})`,
              actual,
            });
          }
        }
      });
    }

    expect(disagreements).toEqual([]);
  });

  it('leaves unclaimed exactly the pairs whose result SQLite coerces', () => {
    const unclaimed: string[] = [];
    const unclaimedAndRefused: string[] = [];

    for (const fixture of FIXTURES) {
      withFixtureTable(fixture, () => {
        for (const operation of BARE_OPERATIONS) {
          if (registry.resolve(operation, { codecId: fixture.codecId }) !== undefined) continue;

          const pair = `${operation}(${fixture.codecId})`;
          unclaimed.push(pair);
          if (probeStorageClass(`${operation}("${COLUMN}")`) === undefined) {
            unclaimedAndRefused.push(pair);
          }
        }
      });
    }

    expect(unclaimed.sort()).toEqual([...COERCED_RATHER_THAN_TYPED, ...UNORDERED].sort());
    // SQLite has no aggregate it refuses over a stored value, so nothing is unclaimed for that reason.
    expect(unclaimedAndRefused).toEqual([]);
  });

  it('offers each lossless variant over exactly the inputs the policy gives it', () => {
    const claimed = Object.fromEntries(
      Object.keys(LOSSLESS_VARIANT_INPUTS).map((operation) => [
        operation,
        FIXTURES.map((fixture) => fixture.codecId)
          .filter((codecId) => registry.resolve(operation, { codecId }) !== undefined)
          .sort(),
      ]),
    );

    expect(claimed).toEqual(LOSSLESS_VARIANT_INPUTS);
  });

  it('offers the lossless sum over every integer input the bare sum accepts, and over no other', () => {
    const integers = [...integerInputs()].sort();
    const claimed = FIXTURES.map((fixture) => fixture.codecId)
      .filter((codecId) => registry.resolve('sumBigInt', { codecId }) !== undefined)
      .sort();

    expect(integers.length).toBeGreaterThan(0);
    expect(claimed).toEqual(integers);
  });

  it('contributes no avgDecimal, having no exact decimal result to answer one with', () => {
    const operations = [...new Set([...registry.values()].map((entry) => entry.operation))].sort();
    const claimingAvgDecimal = FIXTURES.map((fixture) => fixture.codecId).filter(
      (codecId) => registry.resolve('avgDecimal', { codecId }) !== undefined,
    );
    const exactCodecs = [...sqliteCodecRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => /decimal|numeric|unbounded/.test(codecId));

    expect(operations).toEqual(CONTRIBUTED_OPERATIONS);
    expect(claimingAvgDecimal).toEqual([]);
    expect(registry.resolve('avgDecimal')).toBeUndefined();
    // Nor is there a codec such a result could name: no exact decimal, no
    // unbounded integer. An `avg` here is the `real` SQLite computes.
    expect(exactCodecs).toEqual([]);
  });

  it('pins count to a number and countBigInt to a bigint, with and without an input', () => {
    // `lower` is the cast that keeps a wide result readable; its shape is
    // asserted where the lowering itself is, in the defaults suite.
    expect(registry.resolve('count')).toMatchObject({
      operation: 'count',
      output: { codecId: 'sqlite/bigintnumber@1' },
      nullable: false,
    });
    expect(registry.resolve('count', { codecId: 'sqlite/text@1' })?.output).toEqual({
      codecId: 'sqlite/bigintnumber@1',
    });

    expect(registry.resolve('countBigInt')).toMatchObject({
      operation: 'countBigInt',
      output: { codecId: 'sqlite/bigint@1' },
      nullable: false,
    });
    expect(registry.resolve('countBigInt', { codecId: 'sqlite/text@1' })?.output).toEqual({
      codecId: 'sqlite/bigint@1',
    });
  });

  // The min/max fallback rows carry no text cast; the codec's wire decode
  // accepts a `number` or an in-range `bigint`, so an extremum of stored
  // safe-range values is always readable.
  it('resolves min/max over bigintnumber to itself, without a lowering', () => {
    const resolved = registry.resolve('min', { codecId: 'sqlite/bigintnumber@1' });
    expect(resolved?.output).toEqual({ codecId: 'sqlite/bigintnumber@1' });
    expect(resolved?.lower).toBeUndefined();

    expect(registry.resolve('max', { codecId: 'sqlite/bigintnumber@1' })?.output).toEqual({
      codecId: 'sqlite/bigintnumber@1',
    });
  });

  it('declares the nullability an empty set produces', () => {
    withFixtureTable(FIXTURES.find((entry) => entry.codecId === 'sqlite/integer@1')!, () => {
      const [row] = run(
        `SELECT count("${COLUMN}") AS c, sum("${COLUMN}") AS s, avg("${COLUMN}") AS a, min("${COLUMN}") AS m FROM "${TABLE}" WHERE 0`,
      );

      expect({
        count: row?.['c'] !== null,
        sum: row?.['s'] === null,
        avg: row?.['a'] === null,
        min: row?.['m'] === null,
      }).toEqual({ count: true, sum: true, avg: true, min: true });
    });

    // A lossless variant reads the same empty-set answer its bare namesake
    // does, so it declares the same nullability.
    expect({
      count: registry.resolve('count')?.nullable,
      countBigInt: registry.resolve('countBigInt')?.nullable,
      sum: registry.resolve('sum', { codecId: 'sqlite/integer@1' })?.nullable,
      sumBigInt: registry.resolve('sumBigInt', { codecId: 'sqlite/integer@1' })?.nullable,
      avg: registry.resolve('avg', { codecId: 'sqlite/integer@1' })?.nullable,
      min: registry.resolve('min', { codecId: 'sqlite/integer@1' })?.nullable,
    }).toEqual({
      count: false,
      countBigInt: false,
      sum: true,
      sumBigInt: true,
      avg: true,
      min: true,
    });
  });
});
