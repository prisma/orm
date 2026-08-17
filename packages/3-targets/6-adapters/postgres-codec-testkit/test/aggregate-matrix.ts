/**
 * The matrix both aggregate suites measure: one fixture per built-in codec, the
 * operation names, and the policy statements a resolution answer is compared
 * against.
 *
 * The database-backed conformance suite folds these fixtures against a live
 * PostgreSQL; the resolution suite asks the same registry the same questions
 * without one. Keeping the fixtures here is what lets both ask about the same
 * codecs — a codec added to the target shows up in both suites at once, and the
 * coverage test that enforces it lives beside the data it enforces.
 */

import type { JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { postgresAggregateDescriptors } from '@internal/target-postgres/aggregates';
import {
  postgresCodecDescriptorRegistry,
  postgresCodecRegistry,
} from '@internal/target-postgres/codecs';
import { ifDefined } from '@internal/utils/defined';

export const registry = buildSqlAggregateDescriptorRegistry(
  postgresAggregateDescriptors,
  postgresCodecRegistry,
);

/** The operations whose SQL call carries the operation's own name, and whose absence over a type PostgreSQL aggregates is therefore a gap. */
export const BARE_OPERATIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;

/** The lossless variants, each reading the result of the SQL aggregate its bare namesake computes. */
export const LOSSLESS_OPERATIONS = ['countBigInt', 'sumBigInt', 'avgDecimal'] as const;

export const OPERATIONS = [...BARE_OPERATIONS, ...LOSSLESS_OPERATIONS];

/**
 * The rows whose declared codec reads a computed type other than its own native
 * type, and the type PostgreSQL computes for them. `sum` over a 64-bit integer
 * is a `numeric`, which the number-flavoured codec reads as decimal text and
 * guards against the safe-integer range; casting that total down to `bigint`
 * would raise `bigint out of range` past 2^63 instead.
 */
export const READS_A_COMPUTED_TYPE = [
  { operation: 'sum', codecId: 'pg/int8@1', computed: 'numeric' },
  { operation: 'sum', codecId: 'pg/int8number@1', computed: 'numeric' },
] as const;

export const computedTypeFor = (operation: string, codecId: string): string | undefined =>
  READS_A_COMPUTED_TYPE.find((row) => row.operation === operation && row.codecId === codecId)
    ?.computed;

/** The result codecs an integer total reads through, whichever form is asked for. Membership of this set is what makes an input an integer one. */
export const INTEGER_RESULT_CODEC_IDS = ['pg/int8number@1', 'pg/int8@1', 'pg/unboundedint@1'];

/**
 * The inputs each lossless variant claims. `sumBigInt` covers every integer,
 * `unboundedint` included, whose own `sum` is already exact — the suffix is an
 * escape hatch, and one a caller should be able to reach for over any integer
 * column without learning which widths happen not to need it. `avgDecimal`
 * covers every integer and `numeric`, the inputs whose mean PostgreSQL computes
 * exactly. `countBigInt` is input-agnostic like `count`, so it claims every
 * codec and appears in neither list.
 */
export const LOSSLESS_VARIANT_INPUTS: Readonly<Record<string, readonly string[]>> = {
  sumBigInt: [
    'pg/int2@1',
    'pg/int4@1',
    'pg/int8@1',
    'pg/int8number@1',
    'pg/int@1',
    'pg/unboundedint@1',
    'sql/int@1',
  ],
  avgDecimal: [
    'pg/int2@1',
    'pg/int4@1',
    'pg/int8@1',
    'pg/int8number@1',
    'pg/int@1',
    'pg/numeric@1',
    'pg/unboundedint@1',
    'sql/int@1',
  ],
};

const ENUM_TYPE = 'aggregate_conformance_enum';

export interface AggregateFixture {
  readonly codecId: string;
  readonly typeParams?: JsonValue;
  /** Two SQL literals of the codec's native type, so every aggregate has something to fold. */
  readonly samples: readonly [string, string];
  /** SQL that must run before a column of this codec's native type can exist. */
  readonly setupSql?: readonly string[];
}

/**
 * One fixture per built-in codec — enforced by a test in the resolution suite,
 * so a codec added to the target cannot skip the matrix.
 */
export const FIXTURES: readonly AggregateFixture[] = [
  { codecId: 'sql/char@1', samples: ["'a'", "'b'"] },
  { codecId: 'sql/varchar@1', samples: ["'a'", "'b'"] },
  { codecId: 'sql/int@1', samples: ['1', '2'] },
  { codecId: 'sql/float@1', samples: ['1.5', '2.5'] },
  { codecId: 'sql/text@1', samples: ["'a'", "'b'"] },
  { codecId: 'sql/timestamp@1', samples: ["'2024-01-01T10:00:00'", "'2024-02-01T10:00:00'"] },
  { codecId: 'pg/text@1', samples: ["'a'", "'b'"] },
  {
    codecId: 'pg/enum@1',
    typeParams: { typeName: ENUM_TYPE },
    samples: ["'low'", "'high'"],
    setupSql: [
      `DROP TYPE IF EXISTS ${ENUM_TYPE}`,
      `CREATE TYPE ${ENUM_TYPE} AS ENUM ('low', 'high')`,
    ],
  },
  { codecId: 'pg/char@1', samples: ["'a'", "'b'"] },
  { codecId: 'pg/varchar@1', samples: ["'a'", "'b'"] },
  { codecId: 'pg/int@1', samples: ['1', '2'] },
  { codecId: 'pg/float@1', samples: ['1.5', '2.5'] },
  { codecId: 'pg/int4@1', samples: ['1', '2'] },
  { codecId: 'pg/int2@1', samples: ['1', '2'] },
  { codecId: 'pg/int8@1', samples: ['1', '2'] },
  { codecId: 'pg/int8number@1', samples: ['1', '2'] },
  { codecId: 'pg/float4@1', samples: ['1.5', '2.5'] },
  { codecId: 'pg/float8@1', samples: ['1.5', '2.5'] },
  { codecId: 'pg/numeric@1', samples: ['1.5', '2.5'] },
  { codecId: 'pg/unboundedint@1', samples: ['1', '2'] },
  { codecId: 'pg/date@1', samples: ["'2024-01-01'", "'2024-02-01'"] },
  { codecId: 'pg/timestamp@1', samples: ["'2024-01-01T10:00:00'", "'2024-02-01T10:00:00'"] },
  { codecId: 'pg/timestamptz@1', samples: ["'2024-01-01T10:00:00Z'", "'2024-02-01T10:00:00Z'"] },
  { codecId: 'pg/time@1', samples: ["'10:00:00'", "'11:00:00'"] },
  // The `*-string` samples carry microseconds so an aggregate that rounded to
  // milliseconds would change the value it returns rather than pass unnoticed.
  // Temporal-backed siblings of the same columns, with microseconds for the same reason.
  { codecId: 'pg/date-temporal@1', samples: ["'2024-01-01'", "'2024-02-01'"] },
  {
    codecId: 'pg/timestamp-temporal@1',
    typeParams: { precision: 6 },
    samples: ["'2024-01-01T10:00:00.123456'", "'2024-02-01T10:00:00.654321'"],
  },
  {
    codecId: 'pg/timestamptz-temporal@1',
    typeParams: { precision: 6 },
    samples: ["'2024-01-01T10:00:00.123456Z'", "'2024-02-01T10:00:00.654321Z'"],
  },
  {
    codecId: 'pg/time-temporal@1',
    typeParams: { precision: 6 },
    samples: ["'10:00:00.123456'", "'11:00:00.654321'"],
  },
  { codecId: 'pg/date-string@1', samples: ["'2024-01-01'", "'2024-02-01'"] },
  {
    codecId: 'pg/timestamp-string@1',
    typeParams: { precision: 6 },
    samples: ["'2024-01-01T10:00:00.123456'", "'2024-02-01T10:00:00.654321'"],
  },
  {
    codecId: 'pg/timestamptz-string@1',
    typeParams: { precision: 6 },
    samples: ["'2024-01-01T10:00:00.123456Z'", "'2024-02-01T10:00:00.654321Z'"],
  },
  {
    codecId: 'pg/time-string@1',
    typeParams: { precision: 6 },
    samples: ["'10:00:00.123456'", "'11:00:00.654321'"],
  },
  { codecId: 'pg/timetz@1', samples: ["'10:00:00+00'", "'11:00:00+00'"] },
  { codecId: 'pg/bool@1', samples: ['true', 'false'] },
  { codecId: 'pg/bit@1', samples: ["B'1'", "B'0'"] },
  { codecId: 'pg/varbit@1', samples: ["B'101'", "B'1100'"] },
  { codecId: 'pg/bytea@1', samples: ["'\\x01'", "'\\x02'"] },
  {
    codecId: 'pg/uuid@1',
    samples: ["'11111111-1111-1111-1111-111111111111'", "'22222222-2222-2222-2222-222222222222'"],
  },
  { codecId: 'pg/inet@1', samples: ["'10.0.0.1'", "'10.0.0.2'"] },
  { codecId: 'pg/interval@1', samples: ["'1 day'", "'2 days'"] },
  { codecId: 'pg/json@1', samples: ['\'{"a":1}\'', '\'{"b":2}\''] },
  { codecId: 'pg/jsonb@1', samples: ['\'{"a":1}\'', '\'{"b":2}\''] },
  { codecId: 'pg/text-array@1', samples: ["ARRAY['a']", "ARRAY['b']"] },
];

export const TABLE = 'aggregate_conformance';
export const COLUMN = 'value';

export function refOf(fixture: AggregateFixture): CodecRef {
  return { codecId: fixture.codecId, ...ifDefined('typeParams', fixture.typeParams) };
}

export function nativeTypeOf(ref: CodecRef): string {
  const descriptor = postgresCodecDescriptorRegistry.descriptorFor(ref.codecId);
  if (descriptor === undefined) {
    throw new Error(`No PostgreSQL codec descriptor for '${ref.codecId}'.`);
  }
  return descriptor.nativeTypeFor(ref);
}

/** The codecs the bare `sum` totals into an integer result — the integer inputs, read off the matrix rather than listed beside it. */
export function integerInputs(): readonly string[] {
  return FIXTURES.map((fixture) => fixture.codecId).filter((codecId) => {
    const resolved = registry.resolve('sum', { codecId });
    return resolved !== undefined && INTEGER_RESULT_CODEC_IDS.includes(resolved.output.codecId);
  });
}
