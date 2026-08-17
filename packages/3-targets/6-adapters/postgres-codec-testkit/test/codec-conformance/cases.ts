/**
 * Representative application values for every built-in PostgreSQL codec
 * descriptor, exercised against a real database by the conformance suite.
 *
 * `notYetCanonical` marks a case whose projection disagrees with the codec's
 * **current** `encodeJson` / `decodeJson` — the projection will not execute, or
 * the parsed value differs from what `encodeJson` produces, or the value does
 * not survive the round trip back. The suite asserts a marked case still fails
 * and still fails the recorded way, so a projection cannot be brought into
 * agreement without updating this file.
 *
 * A green run is therefore not a claim that every codec's JSON is canonical.
 * Both conditions are measured against the codec's own two methods, so a codec
 * whose `encodeJson` is itself not canonical conforms here: its projection
 * faithfully realizes a representation that is simply not the one the codec ends
 * up with. Such a codec conforms, then transits through a failing state when its
 * canonical form lands, then conforms again.
 *
 * Which codecs are in that position is deliberately not listed here — that list
 * lives in the plan, and a copy of it in this header would go stale every time
 * one of them landed. What this file names is narrower and self-maintaining: the
 * cases that fail *today*, each carrying its own `notYetCanonical` reason.
 *
 * A case is only as good as the boundary it crosses. A value chosen for being
 * typical is the one least likely to expose a format defect — see the base64
 * line-break cases below, where the small value could not have caught it.
 */

import type { PgInterval } from '@internal/target-postgres/codecs';
import type { PostgresCodecConformanceCase } from '../../src/index';

/** Spells out an interval's three fields so a case reads as the value it is. */
const interval = (fields: Partial<PgInterval>): PgInterval => ({
  months: 0,
  days: 0,
  micros: 0n,
  ...fields,
});

const ENUM_TYPE = 'codec_conformance_mood';

/**
 * `extra_float_digits` decides how many digits PostgreSQL prints for a float.
 * At its default of 1 (PostgreSQL 12 and later) it prints the shortest decimal
 * that round-trips; at 0 or below it reverts to a fixed count and truncates.
 * The float codecs' canonical form holds at 1 and above, which these sessions
 * pin so the claim does not rest on the server's default being right.
 */
const floatDigitsSession = (digits: 1 | 3): readonly string[] => [
  `SET extra_float_digits = ${digits}`,
];

/**
 * A session whose temporal settings all differ from the defaults. A temporal
 * case that passes under it renders from the stored value alone rather than
 * inheriting whatever the connected session happens to be set to.
 */
const HOSTILE_TEMPORAL_SESSION: readonly string[] = [
  "SET TimeZone = 'Asia/Kolkata'",
  "SET DateStyle = 'German, DMY'",
  "SET IntervalStyle = 'sql_standard'",
];

export const postgresConformanceCases: readonly PostgresCodecConformanceCase[] = [
  { codecId: 'sql/char@1', label: 'single character', value: 'a' },
  { codecId: 'sql/varchar@1', label: 'text', value: 'hello' },
  { codecId: 'sql/int@1', label: 'integer', value: 42 },
  { codecId: 'sql/float@1', label: 'finite float', value: 1.5 },
  { codecId: 'sql/text@1', label: 'text', value: 'hello' },
  { codecId: 'sql/timestamp@1', label: 'instant', value: new Date('2026-01-02T03:04:05.678Z') },
  {
    codecId: 'sql/timestamp@1',
    label: 'instant under a hostile session',
    value: new Date('2026-01-02T03:04:05.678Z'),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  { codecId: 'pg/text@1', label: 'text', value: 'hello' },
  {
    codecId: 'pg/enum@1',
    label: 'member value',
    value: 'content',
    typeParams: { typeName: ENUM_TYPE },
    setupSql: [
      `DROP TYPE IF EXISTS "${ENUM_TYPE}"`,
      `CREATE TYPE "${ENUM_TYPE}" AS ENUM ('sad', 'content', 'happy')`,
    ],
  },
  { codecId: 'pg/char@1', label: 'single character', value: 'a' },
  { codecId: 'pg/varchar@1', label: 'text', value: 'hello' },
  { codecId: 'pg/int@1', label: 'integer', value: 42 },
  { codecId: 'pg/float@1', label: 'finite float', value: 1.5 },
  { codecId: 'pg/int4@1', label: 'integer', value: 42 },
  { codecId: 'pg/int2@1', label: 'small integer', value: 7 },
  { codecId: 'pg/int8@1', label: 'largest safe integer', value: 9007199254740991n },
  { codecId: 'pg/int8@1', label: 'integer beyond double precision', value: 9007199254740993n },
  { codecId: 'pg/int8@1', label: 'int8 lower bound', value: -9223372036854775808n },
  { codecId: 'pg/int8@1', label: 'int8 upper bound', value: 9223372036854775807n },
  // The safe-range boundaries are the values a JSON-number canonical form is
  // most likely to mangle, so they are the ones that pin it.
  { codecId: 'pg/int8number@1', label: 'largest safe integer', value: 9007199254740991 },
  { codecId: 'pg/int8number@1', label: 'smallest safe integer', value: -9007199254740991 },
  { codecId: 'pg/int8number@1', label: 'small integer', value: 42 },
  { codecId: 'pg/float4@1', label: 'finite float', value: 1.5 },
  { codecId: 'pg/float8@1', label: 'finite float', value: 1.5 },
  // These values are chosen to discriminate between `extra_float_digits`
  // settings, and a simpler one would pin nothing: 0.1 prints as `0.1` at every
  // setting, so a case built on it cannot tell them apart. Each width needs its
  // own value, because each projection prints a different thing:
  //
  //   float8  prints the shortest float8 decimal, so the value is 1/3 itself
  //   float4  prints the shortest *float4* decimal, so the value is the float64
  //           that decimal reads back as — not `Math.fround(1/3)`, which is a
  //           different number that would not survive the printing
  //
  // At `extra_float_digits = 0` these print 15 and 6 significant digits
  // respectively, and neither round-trips.
  {
    codecId: 'pg/float8@1',
    label: 'full precision at the float-digits floor',
    value: 1 / 3,
    setupSql: floatDigitsSession(1),
  },
  {
    codecId: 'pg/float8@1',
    label: 'full precision above the float-digits floor',
    value: 1 / 3,
    setupSql: floatDigitsSession(3),
  },
  {
    codecId: 'pg/float4@1',
    label: 'full precision at the float-digits floor',
    value: 0.33333334,
    setupSql: floatDigitsSession(1),
  },
  {
    codecId: 'pg/float4@1',
    label: 'full precision above the float-digits floor',
    value: 0.33333334,
    setupSql: floatDigitsSession(3),
  },
  {
    codecId: 'pg/float@1',
    label: 'full precision at the float-digits floor',
    value: 1 / 3,
    setupSql: floatDigitsSession(1),
  },
  {
    codecId: 'pg/float@1',
    label: 'full precision above the float-digits floor',
    value: 1 / 3,
    setupSql: floatDigitsSession(3),
  },
  { codecId: 'pg/numeric@1', label: 'representable decimal', value: '1.5' },
  // NaN and the infinities are numeric values rather than error states, and
  // PostgreSQL emits them into JSON as strings, so they round-trip like any
  // other. Nothing else covered them.
  { codecId: 'pg/numeric@1', label: 'not a number', value: 'NaN' },
  { codecId: 'pg/numeric@1', label: 'positive infinity', value: 'Infinity' },
  { codecId: 'pg/numeric@1', label: 'negative infinity', value: '-Infinity' },
  // Past the 38 digits an IEEE-754 double could stand in for, and past the
  // precision any float coercion would survive.
  {
    codecId: 'pg/numeric@1',
    label: 'a hundred significant digits',
    value: `${'9'.repeat(60)}.${'1'.repeat(40)}`,
  },
  { codecId: 'pg/numeric@1', label: 'integer beyond double precision', value: '9007199254740993' },
  {
    codecId: 'pg/numeric@1',
    label: 'twenty fractional digits',
    value: '1234567890.12345678901234567890',
  },
  {
    codecId: 'pg/unboundedint@1',
    label: 'integer beyond double precision',
    value: 9007199254740993n,
  },
  { codecId: 'pg/unboundedint@1', label: 'integer past 2^63', value: 18446744073709551617n },
  {
    codecId: 'pg/unboundedint@1',
    label: 'negative integer past 2^63',
    value: -18446744073709551617n,
  },
  { codecId: 'pg/bool@1', label: 'true', value: true },
  { codecId: 'pg/bit@1', label: 'single bit', value: '1' },
  { codecId: 'pg/varbit@1', label: 'bit string', value: '1010' },
  { codecId: 'pg/bytea@1', label: 'byte string', value: new Uint8Array([0, 1, 255]) },
  // RFC 2045 base64 breaks every 76 characters, which is 57 bytes in. A value
  // has to cross that to show whether the projection carries the break through.
  {
    codecId: 'pg/bytea@1',
    label: 'byte string one past the base64 line break',
    value: Uint8Array.from({ length: 57 }, (_, index) => index),
  },
  {
    codecId: 'pg/bytea@1',
    label: 'byte string spanning several base64 line breaks',
    value: Uint8Array.from({ length: 200 }, (_, index) => (index * 7) % 256),
  },
  { codecId: 'pg/date@1', label: 'calendar date', value: new Date(Date.UTC(2026, 0, 2)) },
  {
    codecId: 'pg/timestamp@1',
    label: 'instant with milliseconds',
    value: new Date('2026-01-02T03:04:05.678Z'),
  },
  {
    codecId: 'pg/timestamp@1',
    label: 'instant under a hostile session',
    value: new Date('2026-01-02T03:04:05.678Z'),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  {
    codecId: 'pg/timestamptz@1',
    label: 'instant with milliseconds',
    value: new Date('2026-01-02T03:04:05.678Z'),
  },
  {
    codecId: 'pg/timestamptz@1',
    label: 'instant under a hostile session',
    value: new Date('2026-01-02T03:04:05.678Z'),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  {
    codecId: 'pg/date@1',
    label: 'calendar date under a hostile session',
    value: new Date(Date.UTC(2026, 0, 2)),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  { codecId: 'pg/time@1', label: 'time of day', value: '03:04:05' },
  {
    codecId: 'pg/time@1',
    label: 'time of day under a hostile session',
    value: '03:04:05',
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  // The Temporal-backed codecs' application value is a `Temporal.*`, so a case is written as the
  // value itself rather than as text. `encodeJson` renders it through `toString()`; the projection
  // currently lets PostgreSQL render the column as JSON, which spells the same instant differently.
  {
    codecId: 'pg/date-temporal@1',
    label: 'calendar date',
    value: Temporal.PlainDate.from('2026-01-02'),
  },
  {
    codecId: 'pg/timestamp-temporal@1',
    label: 'microsecond precision',
    value: Temporal.PlainDateTime.from('2026-01-02T03:04:05.123456'),
    typeParams: { precision: 6 },
  },
  {
    codecId: 'pg/timestamptz-temporal@1',
    label: 'microsecond precision at UTC',
    value: Temporal.Instant.from('2026-01-02T03:04:05.123456Z'),
    typeParams: { precision: 6 },
    notYetCanonical: {
      kind: 'mismatch',
      reason:
        'The identity projection lets PostgreSQL render the column as JSON, which uses a +00:00 offset, against the trailing Z that Instant.toString() produces. The text cast that makes the projection agree with a flat read is not in place yet.',
    },
  },
  {
    codecId: 'pg/time-temporal@1',
    label: 'microsecond precision',
    value: Temporal.PlainTime.from('03:04:05.123456'),
    typeParams: { precision: 6 },
  },
  // The `*-string` codecs' application value is PostgreSQL's own rendering, so each case is written
  // the way the server writes it — space separator, two-digit offset, microseconds. A value picked
  // for looking tidy in JSON (a `T` separator, whole seconds) would agree with today's identity
  // projection for the wrong reason and then disagree once the projection casts to text.
  { codecId: 'pg/date-string@1', label: 'calendar date', value: '2026-01-02' },
  {
    codecId: 'pg/timestamp-string@1',
    label: 'microsecond precision',
    value: '2026-01-02 03:04:05.123456',
    typeParams: { precision: 6 },
    notYetCanonical: {
      kind: 'mismatch',
      reason:
        'The identity projection lets PostgreSQL render the column as JSON, which uses a T separator. The text cast that makes the projection return the same rendering a flat read returns is not in place yet.',
    },
  },
  {
    codecId: 'pg/timestamptz-string@1',
    label: 'microsecond precision at UTC',
    value: '2026-01-02 03:04:05.123456+00',
    typeParams: { precision: 6 },
    notYetCanonical: {
      kind: 'mismatch',
      reason:
        'As for pg/timestamp-string@1, plus an offset PostgreSQL renders as +00:00 in JSON against the +00 a flat read returns.',
    },
  },
  {
    codecId: 'pg/time-string@1',
    label: 'microsecond precision',
    value: '03:04:05.123456',
    typeParams: { precision: 6 },
  },
  { codecId: 'pg/timetz@1', label: 'time of day at UTC', value: '03:04:05+00' },
  {
    codecId: 'pg/timetz@1',
    label: 'time of day at UTC under a hostile session',
    value: '03:04:05+00',
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  // An interval's application value is its three stored fields. A month has no
  // fixed length, so `{ months: 1 }` and `{ days: 30 }` stay distinct rather than
  // collapsing through a common epoch; the ISO string is the JSON side only.
  { codecId: 'pg/interval@1', label: 'one month', value: interval({ months: 1 }) },
  { codecId: 'pg/interval@1', label: 'thirty days', value: interval({ days: 30 }) },
  {
    codecId: 'pg/interval@1',
    label: 'every component',
    value: interval({ months: 14, days: 3, micros: 14_706_000_000n }),
  },
  {
    codecId: 'pg/interval@1',
    label: 'fractional seconds',
    value: interval({ micros: 1_234_567n }),
  },
  {
    codecId: 'pg/interval@1',
    label: 'seven fractional digits round as the database rounds',
    value: interval({ micros: 1_123_457n }),
  },
  { codecId: 'pg/interval@1', label: 'mixed signs', value: interval({ months: 1, days: -1 }) },
  {
    codecId: 'pg/interval@1',
    label: 'wholly negative',
    value: interval({ months: -1, days: -1, micros: -1_250_000n }),
  },
  { codecId: 'pg/interval@1', label: 'zero', value: interval({}) },
  {
    codecId: 'pg/interval@1',
    label: 'months past a year, which the ISO rendering normalises but the value keeps',
    value: interval({ months: 13 }),
  },
  {
    codecId: 'pg/interval@1',
    label: 'every component under a hostile session',
    value: interval({ months: 14, days: 3, micros: 14_706_000_000n }),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  {
    codecId: 'pg/interval@1',
    label: 'mixed signs under a hostile session',
    value: interval({ months: 1, days: -1 }),
    setupSql: HOSTILE_TEMPORAL_SESSION,
  },
  { codecId: 'pg/json@1', label: 'document', value: { a: 1, b: ['x'] } },
  { codecId: 'pg/jsonb@1', label: 'document', value: { a: 1, b: ['x'] } },
  {
    codecId: 'pg/uuid@1',
    label: 'uuid',
    value: '123e4567-e89b-12d3-a456-426614174000',
  },
  { codecId: 'pg/inet@1', label: 'ipv4 address', value: '192.168.0.1' },
  { codecId: 'pg/text-array@1', label: 'string array', value: ['a', 'b'] },
  {
    codecId: 'pg/text-array@1',
    label: 'elements containing array-literal punctuation',
    value: ['a,b', '{c}', 'd"e', 'f\\g', '', ' h '],
  },
  {
    codecId: 'pg/text@1',
    label: 'text needing JSON escaping',
    value: 'quote " backslash \\ newline \n tab \t',
  },
  { codecId: 'pg/text@1', label: 'text beyond the basic plane', value: 'a\u{1F600}b' },
  {
    codecId: 'pg/varchar@1',
    label: 'text needing JSON escaping',
    value: 'quote " backslash \\ newline \n',
  },
  { codecId: 'pg/char@1', label: 'character beyond the basic plane', value: '\u{1F600}' },
  { codecId: 'sql/text@1', label: 'text needing JSON escaping', value: 'quote " backslash \\' },
  { codecId: 'pg/float4@1', label: 'float not exactly representable', value: 0.1 },
  { codecId: 'pg/int2@1', label: 'int2 upper bound', value: 32767 },
  { codecId: 'pg/int2@1', label: 'int2 lower bound', value: -32768 },
  {
    codecId: 'pg/jsonb@1',
    label: 'document whose keys jsonb reorders',
    value: { zebra: 1, a: 2, mm: 3 },
  },
  {
    codecId: 'pg/json@1',
    label: 'document with strings needing escaping',
    value: { 'k"y': 'v\\a"l', nested: ['x\ny'] },
  },
  // Every column can be NULL, and no `value` denotes it: NULL is a state of the
  // column rather than something a codec can be handed. Most codecs reject
  // `null`; the JSON codecs accept it, but there `value: null` means a JSON
  // `null` document stored in the column, not an empty column. A NULL case
  // stores SQL NULL and requires the projection to carry absence through as
  // absence — the dimension an assembled projection gets wrong by reporting an
  // absent value as a present one.
  {
    codecId: 'pg/bit@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/bool@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/bytea@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/char@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/date@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/enum@1',
    label: 'null',
    value: undefined,
    typeParams: { typeName: ENUM_TYPE },
    nullValue: true,
  },
  {
    codecId: 'pg/float4@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/float8@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/float@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/inet@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/int2@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/int4@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/int8@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/int8number@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/int@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/interval@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/json@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/jsonb@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/numeric@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/text-array@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/text@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/time@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/date-temporal@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/timestamp-temporal@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/timestamptz-temporal@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/time-temporal@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/date-string@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/timestamp-string@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/timestamptz-string@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/time-string@1',
    label: 'null',
    value: undefined,
    typeParams: { precision: 6 },
    nullValue: true,
  },
  {
    codecId: 'pg/timestamp@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/timestamptz@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/timetz@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/unboundedint@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/uuid@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/varbit@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'pg/varchar@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/char@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/float@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/int@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/text@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/timestamp@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
  {
    codecId: 'sql/varchar@1',
    label: 'null',
    value: undefined,
    nullValue: true,
  },
];
