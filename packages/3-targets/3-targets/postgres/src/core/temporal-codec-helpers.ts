/**
 * The shared substrate of the eight representation-explicit temporal codecs.
 *
 * Split out of `codec-helpers.ts` when the temporal codecs moved into files of their own: these
 * helpers serve `temporal-codecs.ts` and `temporal-string-codecs.ts` and nothing else, so keeping
 * them beside the generic codec helpers meant a reader of either had to skip the other.
 */

/** The PostgreSQL type each representation pair stores into. Both halves of a pair share one. */
export const PG_DATE_NATIVE_TYPE = 'date';
export const PG_TIMESTAMP_NATIVE_TYPE = 'timestamp without time zone';
export const PG_TIMESTAMPTZ_NATIVE_TYPE = 'timestamp with time zone';
export const PG_TIME_NATIVE_TYPE = 'time';

import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  errorTemporalNonIsoCalendar,
  errorTemporalUnavailable,
  errorTemporalUnrepresentable,
  errorTemporalWrongType,
} from './errors';

/**
 * Temporal-backed codecs: read and write PostgreSQL's temporal text through the global `Temporal`
 * API, which is the authoritative parser *and* the authoritative range check. Nothing below
 * hand-rolls an ISO grammar or a range test — a value Temporal declines is a value this
 * representation cannot carry, and that is reported rather than worked around.
 */

const POSTGRES_TEMPORAL_SENTINELS: ReadonlySet<string> = new Set(['infinity', '-infinity']);

const EXPANDED_YEAR_DIGITS = 6;
const ORDINARY_YEAR_DIGITS = 4;
const BC_SUFFIX = ' BC';

/**
 * Bridges the two spellings PostgreSQL and Temporal use for years outside `0001`–`9999`, and
 * nothing else. PostgreSQL writes an era suffix (`0044-03-15 BC`) and leaves expanded years bare
 * (`12026-01-02`); Temporal wants a signed six-digit proleptic year (`-000043-03-15`,
 * `+012026-01-02`) and note the off-by-one — 44 BC is proleptic year −43, because there is no year
 * zero in the era numbering and there is one in the proleptic.
 *
 * Anything that is not one of those two spellings is returned untouched, including every ordinary
 * date and every non-ISO `DateStyle` rendering. Those go to `Temporal.*.from()` exactly as the
 * server wrote them and are rejected there — this is deliberately not a normaliser that tries to
 * make unparseable text parse.
 */
function adaptPostgresEra(text: string): string {
  const isBc = text.endsWith(BC_SUFFIX);
  const body = isBc ? text.slice(0, -BC_SUFFIX.length) : text;
  const yearEnd = body.indexOf('-');
  if (yearEnd <= 0) {
    return text;
  }
  const yearText = body.slice(0, yearEnd);
  if (!isBc && yearText.length <= ORDINARY_YEAR_DIGITS) {
    return text;
  }
  const year = Number(yearText);
  if (!Number.isInteger(year)) {
    return text;
  }
  const proleptic = isBc ? 1 - year : year;
  const sign = proleptic < 0 ? '-' : '+';
  const digits = String(Math.abs(proleptic)).padStart(EXPANDED_YEAR_DIGITS, '0');
  return `${sign}${digits}${body.slice(yearEnd)}`;
}

/**
 * The lazy capability check. Called at the top of every encode and decode, never during descriptor
 * assembly or contract validation, so a client whose columns are all `*-string` constructs and runs
 * with no Temporal anywhere. `typeof` rather than a property read because an absent global is a
 * ReferenceError on any other form of access.
 */
export function requireTemporal(codecId: string, operation: 'decode' | 'encode'): void {
  if (typeof Temporal === 'undefined') {
    throw errorTemporalUnavailable(codecId, operation);
  }
}

interface TemporalCodecIdentity {
  readonly codecId: string;
  readonly stringType: string;
  /**
   * The `Symbol.toStringTag` the codec's application value carries — `'Temporal.Instant'` and its
   * siblings. Used as the nominal identity of the value on encode; see {@link encodeTemporalValue}.
   */
  readonly temporalTag: string;
}

function decodeTemporalText<T>(
  identity: TemporalCodecIdentity,
  wire: string,
  parse: (text: string) => T,
  adapt: (text: string) => string,
): T {
  requireTemporal(identity.codecId, 'decode');
  if (POSTGRES_TEMPORAL_SENTINELS.has(wire)) {
    throw errorTemporalUnrepresentable({
      ...identity,
      operation: 'decode',
      value: wire,
      detail: `PostgreSQL's ${wire} is a sentinel with no position on the timeline, so no Temporal value denotes it`,
    });
  }
  try {
    return parse(adapt(wire));
  } catch (cause) {
    throw errorTemporalUnrepresentable({
      ...identity,
      operation: 'decode',
      value: wire,
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/**
 * Encodes a `Temporal.*` application value to the text PostgreSQL is sent.
 *
 * The type check is **nominal**, on `Symbol.toStringTag`, not structural. A structural parameter
 * type — anything with a `toString()` and an optional `calendarId` — is satisfied by a `Date`, at
 * compile time and at runtime alike, so a `Date` reaching this function used to be encoded as
 * `Date.prototype.toString()`: `'Tue Aug 18 2026 15:09:05 GMT+0000 (Coordinated Universal Time)'`,
 * which PostgreSQL rejects with a syntax error naming neither the codec nor the cause. The tag is
 * the cheapest identity that holds across a native Temporal and a polyfilled one, where an
 * `instanceof` against either realm's classes would not.
 *
 * The rejection is a structured `RUNTIME.ENCODE_FAILED`, so it reaches the caller with its code
 * and its `fix` intact rather than being re-wrapped by the generic encode path. `fix` is where the
 * `*String` escape hatch is named, which is the one thing a caller who hit this can act on.
 */
function encodeTemporalValue(
  identity: TemporalCodecIdentity,
  value: { readonly calendarId?: string; toString: () => string },
): string {
  requireTemporal(identity.codecId, 'encode');
  const tag: unknown =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, Symbol.toStringTag)
      : undefined;
  if (tag !== identity.temporalTag) {
    throw errorTemporalWrongType(
      identity.codecId,
      identity.temporalTag,
      identity.stringType,
      describeEncodeInput(value, tag),
    );
  }
  if (value.calendarId !== undefined && value.calendarId !== 'iso8601') {
    throw errorTemporalNonIsoCalendar(identity.codecId, value.calendarId);
  }
  return value.toString();
}

/** Names what actually arrived, so the encode failure is actionable without a debugger. */
function describeEncodeInput(value: unknown, tag: unknown): string {
  if (typeof tag === 'string') {
    return `a ${tag}`;
  }
  if (value instanceof Date) {
    return 'a Date';
  }
  if (value === null) {
    return 'null';
  }
  return `a ${typeof value}`;
}

const DATE_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_DATE_TEMPORAL_CODEC_ID,
  stringType: 'DateString',
  temporalTag: 'Temporal.PlainDate',
};
const TIMESTAMP_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  stringType: 'TimestampString(p)',
  temporalTag: 'Temporal.PlainDateTime',
};
const TIMESTAMPTZ_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  stringType: 'TimestamptzString(p)',
  temporalTag: 'Temporal.Instant',
};
const TIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIME_TEMPORAL_CODEC_ID,
  stringType: 'TimeString(p)',
  temporalTag: 'Temporal.PlainTime',
};

// A time-of-day carries no year, so the era adaptation has nothing to do for it.
const unadapted = (text: string): string => text;

export const pgDateTemporalDecode = (wire: string): Temporal.PlainDate =>
  decodeTemporalText(DATE_TEMPORAL, wire, (t) => Temporal.PlainDate.from(t), adaptPostgresEra);

export const pgDateTemporalEncode = (value: Temporal.PlainDate): string =>
  encodeTemporalValue(DATE_TEMPORAL, value);

export const pgTimestampTemporalDecode = (wire: string): Temporal.PlainDateTime =>
  decodeTemporalText(
    TIMESTAMP_TEMPORAL,
    wire,
    (t) => Temporal.PlainDateTime.from(t),
    adaptPostgresEra,
  );

export const pgTimestampTemporalEncode = (value: Temporal.PlainDateTime): string =>
  encodeTemporalValue(TIMESTAMP_TEMPORAL, value);

export const pgTimestamptzTemporalDecode = (wire: string): Temporal.Instant =>
  decodeTemporalText(TIMESTAMPTZ_TEMPORAL, wire, (t) => Temporal.Instant.from(t), adaptPostgresEra);

export const pgTimestamptzTemporalEncode = (value: Temporal.Instant): string =>
  encodeTemporalValue(TIMESTAMPTZ_TEMPORAL, value);

export const pgTimeTemporalDecode = (wire: string): Temporal.PlainTime =>
  decodeTemporalText(TIME_TEMPORAL, wire, (t) => Temporal.PlainTime.from(t), unadapted);

export const pgTimeTemporalEncode = (value: Temporal.PlainTime): string =>
  encodeTemporalValue(TIME_TEMPORAL, value);
