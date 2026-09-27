/**
 * Conformance for `pg/vector@1` against a real database with the extension
 * installed.
 *
 * The extension's descriptor is not in the target's built-in registry, so each
 * case carries it directly; everything else runs through the same harness the
 * built-in codecs use, so what is asserted here is what is asserted there —
 * parsed projection JSON equals `encodeJson`, and `decodeJson` returns the
 * application value.
 *
 * `CREATE EXTENSION` runs in each case's setup rather than being assumed: if the
 * bundle ever stops shipping, these fail loudly at the point of the missing
 * dependency instead of somewhere downstream.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import type {
  ConformanceConnection,
  PostgresCodecConformanceCase,
} from '@internal/postgres-codec-testkit';
import { runPostgresCodecProjection } from '@internal/postgres-codec-testkit';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

const INSTALL_VECTOR = ['CREATE EXTENSION IF NOT EXISTS vector'] as const;

function vectorCase(
  label: string,
  value: number[],
  options: { readonly length?: number; readonly floatDigits?: 1 | 3 } = {},
): PostgresCodecConformanceCase {
  const setupSql =
    options.floatDigits === undefined
      ? INSTALL_VECTOR
      : [...INSTALL_VECTOR, `SET extra_float_digits = ${options.floatDigits}`];
  return {
    codecId: 'pg/vector@1',
    descriptor: pgVectorDescriptor,
    label,
    value,
    typeParams: { length: options.length ?? value.length },
    setupSql,
  };
}

const cases: readonly PostgresCodecConformanceCase[] = [
  ...[[1], [1, 2, 3]].map(
    (value): PostgresCodecConformanceCase => ({
      codecId: 'pg/vector@1',
      descriptor: pgVectorDescriptor,
      label: `variable vector with ${value.length} dimensions`,
      value,
      typeParams: {},
      setupSql: INSTALL_VECTOR,
    }),
  ),
  vectorCase('three dimensions', [1, 2, 3]),
  // A vector's text form separates elements with commas and wraps them in
  // brackets, so a value has to carry negatives and fractions before the
  // reinterpretation as JSON is doing anything a plain string would not.
  vectorCase('negative and fractional elements', [-1.5, 0, 0.25]),
  vectorCase('a single dimension', [42]),
  // pgvector stores elements as `real`, so a value has to be exactly
  // representable in a 32-bit float to round-trip at all. These are dyadic, and
  // deliberately so: a value like `index / 1536` is not, and would fail for a
  // reason that has nothing to do with the projection.
  vectorCase('elements at the edge of float4 precision', [
    Math.fround(0.1),
    Math.fround(-1 / 3),
    Math.fround(Math.PI),
  ]),
  // A short vector fits any buffer; a wide one is where a text-form assumption
  // would show.
  vectorCase(
    'many dimensions',
    Array.from({ length: 1536 }, (_, index) => index / 2048),
  ),
  // `extra_float_digits` decides how many digits a float prints. At its default
  // of 1 the projection prints the exact float64 a `real` denotes; at 0 or below
  // it truncates. These pin the canonical form at the floor and above it.
  //
  // The value discriminates and a simpler one would not: 0.1 prints identically
  // at every setting. Note it differs from `pg/float4@1`'s case for the same
  // property — this projection widens each element to float8 before printing, so
  // the value is the exact float64 of the float4, where a bare float4 column
  // prints its own shortest decimal instead.
  vectorCase('full precision at the float-digits floor', [Math.fround(1 / 3)], {
    floatDigits: 1,
  }),
  vectorCase('full precision above the float-digits floor', [Math.fround(1 / 3)], {
    floatDigits: 3,
  }),
];

/**
 * A `many` column of vectors — a `vector[]` — which is what actually routes
 * through the inherited array lift. A single `vector` does not: it is a scalar
 * whose representation happens to be an array, and the lift fires on
 * `CodecRef.many`.
 */
const manyVectorCases: readonly PostgresCodecConformanceCase[] = [
  {
    codecId: 'pg/vector@1',
    descriptor: pgVectorDescriptor,
    label: 'a column of several vectors',
    value: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    typeParams: { length: 3 },
    many: true,
    setupSql: INSTALL_VECTOR,
  },
  {
    codecId: 'pg/vector@1',
    descriptor: pgVectorDescriptor,
    label: 'a null column of vectors',
    value: null,
    typeParams: { length: 3 },
    many: true,
    setupSql: INSTALL_VECTOR,
  },
  {
    codecId: 'pg/vector@1',
    descriptor: pgVectorDescriptor,
    label: 'a column of vectors with a null element',
    value: [[1, 2, 3], null],
    typeParams: { length: 3 },
    many: true,
    setupSql: INSTALL_VECTOR,
  },
];

describe('pgvector codec JSON-projection conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
    connection = { query: async (sql, params) => (await driver!.query(sql, params)).rows };
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    connection = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  for (const conformanceCase of [...cases, ...manyVectorCases]) {
    it(`pg/vector@1 (${conformanceCase.label}) agrees with encodeJson and round-trips through decodeJson`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      const outcome = await runPostgresCodecProjection(connection!, conformanceCase);
      expect(outcome.failure).toBeUndefined();
    });
  }
});
