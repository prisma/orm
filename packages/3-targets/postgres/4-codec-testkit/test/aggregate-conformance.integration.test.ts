/**
 * Measures the PostgreSQL target's aggregate descriptors against the database
 * they describe.
 *
 * For every built-in codec and every built-in aggregate the suite asks two
 * questions of a live PostgreSQL: does this aggregate exist over this type at
 * all, and — when it does — what type does it return? Both answers are compared
 * against what the aggregate registry resolves, so a descriptor claiming a
 * result codec PostgreSQL does not produce fails here, and so does a pair the
 * descriptors leave unclaimed that PostgreSQL would in fact aggregate. What the
 * registry answers where no probe can settle it — which inputs a lossless
 * variant is offered over, which overload wins a tie — is the sibling
 * `aggregate-resolution.test.ts`, which needs no database.
 *
 * Result types are compared as `regtype`, which ignores type modifiers: what is
 * asserted is that `min` over a `numeric(10,3)` returns *a* numeric, not that it
 * returns one of the same precision.
 *
 * What each row runs is the expression its lowering builds, not a call named
 * after the operation: `countBigInt`, `sumBigInt`, and `avgDecimal` compute with
 * the SQL aggregate their bare namesakes use and differ in how the result is
 * read, and `avg` over an integer casts its result. So every probe here renders
 * the row's own lowering.
 *
 * Two rows declare a codec whose native type is not the type PostgreSQL
 * computes — `sum` over a 64-bit integer, whose `numeric` total the
 * number-flavoured codec reads and range-guards. They are named in
 * `READS_A_COMPUTED_TYPE`, which the matrix measures against.
 *
 * The pairs PostgreSQL refuses, and which therefore carry no descriptor:
 * `sum`/`avg` over every non-numeric, non-temporal type (including `oid`, and
 * `money`'s `avg`, although it has a `sum`); and
 * `min`/`max` over `bool`, `uuid`, `bytea`, `bit`, `bit varying`, `json`, and
 * `jsonb` — all of which advertise `equality` or `order` and would have been
 * swept up by a trait fallback inferred from traits rather than probed. That
 * measurement applies to the bare operations, whose SQL call is the operation's
 * own name; where a lossless variant is offered is policy, and is pinned as
 * such next door.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { SqlQueryError } from '@internal/sql-errors';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AggregateFixture,
  BARE_OPERATIONS,
  COLUMN,
  computedTypeFor,
  FIXTURES,
  OPERATIONS,
  refOf,
  registry,
  TABLE,
  typeTextOf,
} from './aggregate-matrix';
import { aggregateSql } from './aggregate-sql';

type Query = (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

/** SQLSTATE `undefined_function` — what PostgreSQL raises for an aggregate it does not have over this type (probed: `sum(bool)` → 42883). */
const UNDEFINED_FUNCTION = '42883';

/**
 * The result type PostgreSQL gives the aggregate expression, or `undefined` when
 * it has no such aggregate. Only `undefined_function` reads as refusal — the
 * harness driver normalizes SQLSTATE errors onto `SqlQueryError.sqlState`, and
 * anything else (a missing table's 42P01, a dropped connection, a syntax slip)
 * is rethrown: in the unclaimed direction a swallowed infrastructure error would
 * pass the matrix vacuously.
 */
async function probeResultType(query: Query, expression: string): Promise<string | undefined> {
  try {
    const rows = await query(`SELECT pg_typeof(${expression})::text AS result FROM "${TABLE}"`);
    return String(rows[0]?.['result']);
  } catch (error) {
    if (SqlQueryError.is(error) && error.sqlState === UNDEFINED_FUNCTION) return undefined;
    throw error;
  }
}

/** Whether PostgreSQL considers the aggregate's result type and the expected native type the same type, modifiers aside. */
async function producesExpectedType(
  query: Query,
  expression: string,
  expectedNativeType: string,
): Promise<boolean> {
  const rows = await query(
    `SELECT pg_typeof(${expression}) = pg_typeof(NULL::${expectedNativeType}) AS agrees FROM "${TABLE}"`,
  );
  return rows[0]?.['agrees'] === true;
}

describe('PostgreSQL aggregate conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let query: Query;

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

  async function withFixtureTable<T>(
    fixture: AggregateFixture,
    body: () => Promise<T>,
  ): Promise<T> {
    await query(`DROP TABLE IF EXISTS "${TABLE}"`);
    for (const statement of fixture.setupSql ?? []) {
      await query(statement);
    }
    const typeText = typeTextOf(refOf(fixture));
    await query(`CREATE TABLE "${TABLE}" ("${COLUMN}" ${typeText})`);
    for (const sample of fixture.samples) {
      await query(`INSERT INTO "${TABLE}" ("${COLUMN}") VALUES ((${sample})::${typeText})`);
    }
    return body();
  }

  it(
    'declares the result type PostgreSQL produces, for every aggregate it declares',
    async () => {
      const disagreements: unknown[] = [];

      for (const fixture of FIXTURES) {
        await withFixtureTable(fixture, async () => {
          for (const operation of OPERATIONS) {
            const resolved = registry.resolve(operation, refOf(fixture));
            if (resolved === undefined) continue;

            const expression = aggregateSql({
              operation,
              lower: resolved.lower,
              inputCodec: refOf(fixture),
              table: TABLE,
              column: COLUMN,
            });
            const actual = await probeResultType(query, expression);
            if (actual === undefined) {
              disagreements.push({
                operation,
                codecId: fixture.codecId,
                declared: resolved.output.codecId,
                actual: 'PostgreSQL has no such aggregate',
              });
              continue;
            }
            const expected =
              computedTypeFor(operation, fixture.codecId) ?? typeTextOf(resolved.output);
            if (!(await producesExpectedType(query, expression, expected))) {
              disagreements.push({
                operation,
                codecId: fixture.codecId,
                declared: `${resolved.output.codecId} (${expected})`,
                actual,
              });
            }
          }
        });
      }

      expect(disagreements).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'leaves unclaimed only the pairs PostgreSQL refuses',
    async () => {
      const unclaimedButSupported: unknown[] = [];

      for (const fixture of FIXTURES) {
        await withFixtureTable(fixture, async () => {
          for (const operation of BARE_OPERATIONS) {
            if (registry.resolve(operation, refOf(fixture)) !== undefined) continue;

            const actual = await probeResultType(query, `${operation}("${COLUMN}")`);
            if (actual !== undefined) {
              unclaimedButSupported.push({ operation, codecId: fixture.codecId, actual });
            }
          }
        });
      }

      expect(unclaimedButSupported).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'produces the empty-set answer the rows declare nullability for',
    async () => {
      await withFixtureTable({ codecId: 'pg/int4@1', samples: ['1', '2'] }, async () => {
        const rows = await query(
          `SELECT count("${COLUMN}") AS c, sum("${COLUMN}") AS s, avg("${COLUMN}") AS a, min("${COLUMN}") AS m FROM "${TABLE}" WHERE false`,
        );
        const row = rows[0] ?? {};

        expect({
          count: row['c'] !== null,
          sum: row['s'] === null,
          avg: row['a'] === null,
          min: row['m'] === null,
        }).toEqual({ count: true, sum: true, avg: true, min: true });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
