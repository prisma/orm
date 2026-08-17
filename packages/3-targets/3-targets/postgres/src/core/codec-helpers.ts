/**
 * Shared encode/decode/render constants for the Postgres target codecs.
 *
 * The codec implementations live in `codecs.ts` (TML-2357). This file retains the conversion helpers + emit-path type renderers that the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 *
 * Trivial identity passthroughs are inlined directly in the codec methods; only conversions with shape (custom JSON round-trip, decode normalisation, parameterised renderers) live here.
 */

import type { JsonValue } from '@internal/contract/types';
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
  postgresError,
} from './errors';

/**
 * The emit path hands these renderers whatever the contract carried: `renderOutputTypeFor` reads
 * `typeParams` out of the contract and calls straight through without validating it. So the
 * property is declared `unknown` rather than `number` — that is what it is at runtime, it keeps the
 * guards below live rather than dead, and it lets a descriptor pass its own precisely-typed params
 * without a cast.
 */
export function renderLength(
  typeName: string,
  typeParams: { readonly length?: unknown },
): string | undefined {
  const length = typeParams.length;
  if (length === undefined) {
    return undefined;
  }
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw postgresError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "length" in typeParams for ${typeName}, got ${String(length)}`,
      { meta: { nativeType: typeName, param: 'length', received: String(length) } },
    );
  }
  return `${typeName}<${length}>`;
}

export function renderPrecision(
  typeName: string,
  typeParams: { readonly precision?: unknown },
): string {
  const precision = typeParams.precision;
  if (precision === undefined) {
    return typeName;
  }
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw postgresError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "precision" in typeParams for ${typeName}, got ${String(precision)}`,
      { meta: { nativeType: typeName, param: 'precision', received: String(precision) } },
    );
  }
  return `${typeName}<${precision}>`;
}

export const pgNumericDecode = (wire: string | number): string => {
  if (typeof wire === 'number') return String(wire);
  return wire;
};

const DECIMAL_INTEGER = /^-?\d+$/;

/**
 * Requires an application value to be of the JS type the codec reads.
 *
 * A range check reads a value of the wrong type as a value out of range, and
 * reports a number plainly inside the range as outside it — so the type is
 * established first and answered for on its own terms, naming what a caller
 * has to change.
 */
const requireJsType = (codecId: string, expected: 'number' | 'bigint', value: unknown): void => {
  if (typeof value === expected) return;
  throw postgresError(
    'RUNTIME.ENCODE_FAILED',
    `${codecId} value must be a ${expected}, got ${typeof value} ${String(value)}`,
    { meta: { codecId, received: typeof value } },
  );
};

/** Writes a `bigint` application value as the decimal text the wire form of the exact integer codecs carries. */
export const pgBigintEncode = (codecId: string, value: bigint): string => {
  requireJsType(codecId, 'bigint', value);
  return value.toString();
};

/**
 * Writes an application value as the decimal text these codecs carry as their
 * canonical JSON.
 *
 * A schema-written literal default (`BigInt @default(0)`) arrives here as a
 * `number`, since a number literal is the only integer a schema language
 * writes, and one that is a safe integer names its value exactly. Past that
 * range the literal was rounded before any of this ran, so the value written is
 * not the value meant — which this refuses rather than minting an exact-looking
 * total from it. A non-integral number is refused on the same terms.
 */
export const pgBigintEncodeJson = (codecId: string, value: bigint | number): string => {
  if (typeof value !== 'number') return pgBigintEncode(codecId, value);
  if (!Number.isSafeInteger(value)) {
    throw postgresError(
      'RUNTIME.ENCODE_FAILED',
      `${codecId} number literal must be an integer within the safe integer range, got ${String(value)}`,
      { meta: { codecId, received: String(value) } },
    );
  }
  return BigInt(value).toString();
};

/**
 * Reads a wire or JSON value as a `bigint`, rejecting anything `BigInt()` would
 * misread. A number-typed wire value must also be a safe integer: past
 * ±(2^53 − 1) the driver's `number` has already rounded, so stringifying it
 * would mint a spuriously-exact `bigint` that need not equal the stored value.
 */
const decimalIntegerDecode = (codecId: string, wire: string | number | bigint): bigint => {
  if (typeof wire === 'bigint') return wire;
  const text = String(wire);
  if (!DECIMAL_INTEGER.test(text)) {
    throw postgresError('RUNTIME.DECODE_FAILED', `${codecId} value must be a decimal integer`, {
      meta: { codecId, received: text },
    });
  }
  if (typeof wire === 'number' && !Number.isSafeInteger(wire)) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} wire number must be an integer within the safe integer range, got ${text}`,
      { meta: { codecId, received: text } },
    );
  }
  return BigInt(text);
};

/** Reads an `int8` wire or JSON value as a `bigint`, rejecting anything `BigInt()` would misread. */
export const pgInt8Decode = (wire: string | number | bigint): bigint =>
  decimalIntegerDecode('pg/int8@1', wire);

/**
 * Reads an unconstrained-`numeric` wire or JSON value as a `bigint`, rejecting
 * non-integral values — including `NaN` and the infinities, which are `numeric`
 * values but not integers.
 */
export const pgUnboundedIntDecode = (wire: string | number | bigint): bigint =>
  decimalIntegerDecode('pg/unboundedint@1', wire);

const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Requires an integer within ±(2^53 − 1), the range a JS `number` holds
 * exactly. The guard throws rather than rounding: past the boundary a `number`
 * silently loses digits, which is the failure mode this codec exists to refuse.
 */
const pgInt8NumberGuard = (
  code: 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED',
  value: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    throw postgresError(
      code,
      `pg/int8number@1 value must be an integer within the safe integer range, got ${String(value)}`,
      { meta: { codecId: 'pg/int8number@1', received: String(value) } },
    );
  }
  return value;
};

export const pgInt8NumberEncodeJson = (value: number): number => {
  requireJsType('pg/int8number@1', 'number', value);
  return pgInt8NumberGuard('RUNTIME.ENCODE_FAILED', value);
};

export const pgInt8NumberEncode = (value: number): string => String(pgInt8NumberEncodeJson(value));

/**
 * Reads an `int8` wire value as a `number`, throwing outside ±(2^53 − 1) and on
 * non-integral input. Decimal text goes through `BigInt` before the range check
 * so an out-of-range value is compared exactly rather than after rounding.
 */
export const pgInt8NumberDecode = (wire: string | number | bigint): number => {
  if (typeof wire === 'number') return pgInt8NumberGuard('RUNTIME.DECODE_FAILED', wire);
  const value = decimalIntegerDecode('pg/int8number@1', wire);
  if (value < MIN_SAFE_INTEGER_BIGINT || value > MAX_SAFE_INTEGER_BIGINT) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `pg/int8number@1 value must be an integer within the safe integer range, got ${value}`,
      { meta: { codecId: 'pg/int8number@1', received: value.toString() } },
    );
  }
  return Number(value);
};

export const pgInt8NumberDecodeJson = (json: JsonValue): number => {
  if (typeof json !== 'number') {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      'pg/int8number@1 database JSON value must be a number',
      { meta: { codecId: 'pg/int8number@1', received: typeof json } },
    );
  }
  return pgInt8NumberGuard('RUNTIME.DECODE_FAILED', json);
};

/**
 * Renders a decimal-text default as a `bigint` literal, for the codecs whose
 * canonical JSON is decimal text while the application type is `bigint`
 * (`pg/int8@1`, `pg/unboundedint@1`) — a plain string literal would not
 * typecheck against the emitted column type.
 */
export const decimalTextBigintLiteral = (value: JsonValue): string | undefined =>
  typeof value === 'string' && DECIMAL_INTEGER.test(value) ? `${value}n` : undefined;

export const pgNumericRenderOutputType = (typeParams: {
  readonly precision?: number;
  readonly scale?: number;
}): string | undefined => {
  const precision = typeParams.precision;
  if (precision === undefined) return undefined;
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw postgresError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "precision" in typeParams for Numeric, got ${String(precision)}`,
      { meta: { nativeType: 'Numeric', param: 'precision', received: String(precision) } },
    );
  }
  const scale = typeParams.scale;
  if (scale === undefined) return `Numeric<${precision}>`;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || !Number.isInteger(scale)) {
    throw postgresError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "scale" in typeParams for Numeric, got ${String(scale)}`,
      { meta: { nativeType: 'Numeric', param: 'scale', received: String(scale) } },
    );
  }
  return `Numeric<${precision}, ${scale}>`;
};

const ISO_8601_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;
const ISO_8601_TIMESTAMPTZ =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export const pgTimestampEncodeJson = (value: Date): JsonValue => value.toISOString().slice(0, -1);
export const pgTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Expected ISO date string for pg/timestamp@1, got ${typeof json}`,
      { meta: { codecId: 'pg/timestamp@1', received: typeof json } },
    );
  }
  if (!ISO_8601_TIMESTAMP.test(json)) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Invalid ISO date string for pg/timestamp@1: ${json}`,
      { meta: { codecId: 'pg/timestamp@1', received: json } },
    );
  }
  const date = new Date(`${json}Z`);
  if (Number.isNaN(date.getTime())) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Invalid ISO date string for pg/timestamp@1: ${json}`,
      { meta: { codecId: 'pg/timestamp@1', received: json } },
    );
  }
  return date;
};

export const pgTimestamptzEncodeJson = (value: Date): JsonValue =>
  value.toISOString().replace(/Z$/, '+00:00');
export const pgTimestamptzDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Expected ISO date string for pg/timestamptz@1, got ${typeof json}`,
      { meta: { codecId: 'pg/timestamptz@1', received: typeof json } },
    );
  }
  if (!ISO_8601_TIMESTAMPTZ.test(json)) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Invalid ISO date string for pg/timestamptz@1: ${json}`,
      { meta: { codecId: 'pg/timestamptz@1', received: json } },
    );
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Invalid ISO date string for pg/timestamptz@1: ${json}`,
      { meta: { codecId: 'pg/timestamptz@1', received: json } },
    );
  }
  return date;
};

const ISO_8601_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A Postgres `date` has no time-of-day or timezone component, so `pg/date@1`
 * canonicalizes its JS-level value as a `Date` at UTC midnight
 * (`Date.UTC(y, m, d)`), independent of the process's local timezone.
 *
 * `pgDateEncode` reads the calendar date via UTC getters (matching that
 * canonical form) and formats it as `YYYY-MM-DD` directly, bypassing the pg
 * driver's own `Date` serialization (`dateToString`), which reads *local*
 * getters and would shift the calendar day near midnight in negative-UTC-offset
 * environments.
 */
export const pgDateEncode = (value: Date): string =>
  formatDateOnly(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());

/**
 * Normalizes the pg driver's already-parsed `Date` for a `date` column into
 * the canonical UTC-midnight form. The driver (via `postgres-date`) builds
 * that `Date` at *local* midnight from the wire text; reading it back with the
 * same (local) getters recovers the exact calendar date the driver parsed,
 * and reconstructing via `Date.UTC` makes the result's instant independent of
 * the process's timezone.
 */
export const pgDateDecode = (wire: Date): Date =>
  new Date(Date.UTC(wire.getFullYear(), wire.getMonth(), wire.getDate()));

export const pgDateEncodeJson = (value: Date): JsonValue => pgDateEncode(value);

export const pgDateDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `Expected date string for pg/date@1, got ${typeof json}`,
      { meta: { codecId: 'pg/date@1', received: typeof json } },
    );
  }
  const match = ISO_8601_DATE.exec(json);
  if (!match) {
    throw postgresError('RUNTIME.DECODE_FAILED', `Invalid date string for pg/date@1: ${json}`, {
      meta: { codecId: 'pg/date@1', received: json },
    });
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw postgresError('RUNTIME.DECODE_FAILED', `Invalid date string for pg/date@1: ${json}`, {
      meta: { codecId: 'pg/date@1', received: json },
    });
  }
  return date;
};

/**
 * The application value of a `pg/interval@1` column.
 *
 * A PostgreSQL interval is three independent fields — months, days and
 * microseconds — not a single duration. `1 month` and `30 days` are different
 * intervals because a month has no fixed length, so the three fields are carried
 * separately and never collapsed into one another. Reading a value is therefore
 * reading these three numbers, not parsing a string.
 *
 * `months` and `days` are `number` because PostgreSQL stores each as a 32-bit
 * integer, which a JS number holds exactly. `micros` is `bigint` because
 * PostgreSQL stores it as a 64-bit integer, whose range a JS number does not
 * cover — the same reason `pg/int8@1` carries `bigint`.
 *
 * The canonical JSON of this codec is the ISO-8601 duration string, not this
 * object: the value and its representation are independent, as they are for
 * `pg/bytea@1` (`Uint8Array` / base64) and `pg/int8@1` (`bigint` / decimal text).
 */
export interface PgInterval {
  readonly months: number;
  readonly days: number;
  readonly micros: bigint;
}

const ISO_DURATION =
  /^P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?$/;

const MICROS_PER_SECOND = 1_000_000n;

/**
 * Converts a fractional-seconds digit string to microseconds, rounding rather
 * than truncating past the sixth digit.
 *
 * PostgreSQL rounds: `INTERVAL '1.1234567 seconds'` is `1.123457`, and
 * `'1.9999999 seconds'` carries into `2`. Truncating here made the parsed value
 * disagree with the database for any input past microsecond resolution.
 *
 * Ties round toward positive infinity, matching `Math.round` on the sibling path
 * that reads the driver's component object — so the two agree. PostgreSQL's own
 * tie behaviour is unobservable, because it parses the literal into a double
 * first and an exact half never survives that.
 */
const microsFromFraction = (fraction: string, negative: boolean): bigint => {
  if (fraction === '') return 0n;
  const kept = BigInt(fraction.slice(0, 6).padEnd(6, '0'));
  const rest = fraction.slice(6).replace(/0+$/, '');
  if (rest === '') return kept;
  const half = rest[0] === '5' && rest.length === 1;
  const roundsUp = rest > '5' || (half && !negative);
  return roundsUp ? kept + 1n : kept;
};

const intervalFieldsOf = (text: string): PgInterval => {
  const match = ISO_DURATION.exec(text);
  if (match === null) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `pg/interval@1 value must be an ISO-8601 duration, got ${text}`,
      { meta: { codecId: 'pg/interval@1', received: text } },
    );
  }
  const [, years, months, days, hours, minutes, seconds] = match;
  const wholeNumber = (part: string | undefined): number =>
    part === undefined ? 0 : Number(part.slice(0, -1));
  const secondsLiteral = seconds === undefined ? '0' : seconds.slice(0, -1);
  const negative = secondsLiteral.startsWith('-');
  const [whole = '0', fraction = ''] = secondsLiteral.replace('-', '').split('.');
  const magnitude = BigInt(whole) * MICROS_PER_SECOND + microsFromFraction(fraction, negative);

  return {
    months: wholeNumber(years) * 12 + wholeNumber(months),
    days: wholeNumber(days),
    micros:
      BigInt(wholeNumber(hours)) * 3_600n * MICROS_PER_SECOND +
      BigInt(wholeNumber(minutes)) * 60n * MICROS_PER_SECOND +
      (negative ? -magnitude : magnitude),
  };
};

const secondsText = (micros: bigint): string => {
  const sign = micros < 0n ? '-' : '';
  const magnitude = micros < 0n ? -micros : micros;
  const whole = (magnitude / MICROS_PER_SECOND) % 60n;
  const fraction = magnitude % MICROS_PER_SECOND;
  const fractionText =
    fraction === 0n ? '' : `.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${sign}${whole}${fractionText}`;
};

/**
 * Renders {@link PgInterval} the way PostgreSQL spells an interval under
 * `IntervalStyle = 'iso_8601'`: zero components omitted, `T` present only when a
 * time component is, each component carrying its own sign, and an all-zero
 * interval written `PT0S`.
 */
const formatIsoDuration = ({ months, days, micros }: PgInterval): string => {
  const years = Math.trunc(months / 12);
  const restMonths = months % 12;
  const sign = micros < 0n ? '-' : '';
  const magnitude = micros < 0n ? -micros : micros;
  const hours = magnitude / (3_600n * MICROS_PER_SECOND);
  const minutes = (magnitude / (60n * MICROS_PER_SECOND)) % 60n;
  const hasSeconds = magnitude % (60n * MICROS_PER_SECOND) !== 0n;

  const parts = [
    years === 0 ? '' : `${years}Y`,
    restMonths === 0 ? '' : `${restMonths}M`,
    days === 0 ? '' : `${days}D`,
  ];
  const time = [
    hours === 0n ? '' : `${sign}${hours}H`,
    minutes === 0n ? '' : `${sign}${minutes}M`,
    hasSeconds ? `${secondsText(micros)}S` : '',
  ].join('');

  const rendered = `P${parts.join('')}${time === '' ? '' : `T${time}`}`;
  return rendered === 'P' ? 'PT0S' : rendered;
};

/** Normalises any accepted ISO-8601 duration to the canonical spelling. */
export const pgIntervalCanonical = (text: string): string =>
  formatIsoDuration(intervalFieldsOf(text));

/** Parses an ISO-8601 duration into the application value. */
export const pgIntervalFromIso = (text: string): PgInterval => intervalFieldsOf(text);

/** Renders the application value as its canonical ISO-8601 duration. */
export const pgIntervalToIso = (value: PgInterval): string => formatIsoDuration(value);

export const pgIntervalEncodeJson = (value: PgInterval): JsonValue => formatIsoDuration(value);

export const pgIntervalDecodeJson = (json: JsonValue): PgInterval => {
  if (typeof json !== 'string') {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      'pg/interval@1 database JSON value must be an ISO-8601 duration string',
      { meta: { codecId: 'pg/interval@1', received: typeof json } },
    );
  }
  return intervalFieldsOf(json);
};

/**
 * Reads the driver's wire value into the application value. `pg` parses an
 * interval into a component object, which is the same three fields under other
 * names; a text wire value is an ISO-8601 duration, because that is what the
 * codec writes.
 */
export const pgIntervalDecode = (wire: string | Record<string, unknown>): PgInterval => {
  if (typeof wire === 'string') return intervalFieldsOf(wire);
  const part = (name: string): number => {
    const raw = wire[name];
    return typeof raw === 'number' ? raw : 0;
  };
  const seconds = part('seconds') + part('milliseconds') / 1_000;
  return {
    months: part('years') * 12 + part('months'),
    days: part('days'),
    micros:
      BigInt(part('hours')) * 3_600n * MICROS_PER_SECOND +
      BigInt(part('minutes')) * 60n * MICROS_PER_SECOND +
      BigInt(Math.round(seconds * 1_000_000)),
  };
};

const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const pgByteaEncodeJson = (value: Uint8Array): JsonValue =>
  Buffer.from(value).toString('base64');

export const pgByteaDecodeJson = (value: JsonValue): Uint8Array => {
  if (typeof value !== 'string' || !BASE64_TEXT.test(value)) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      'pg/bytea@1 database JSON value must be a base64 string',
      { meta: { codecId: 'pg/bytea@1' } },
    );
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};

export const pgJsonEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;

export const pgJsonbEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonbDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;

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

function encodeTemporalValue(
  identity: TemporalCodecIdentity,
  value: { readonly calendarId?: string; toString: () => string },
): string {
  requireTemporal(identity.codecId, 'encode');
  if (value.calendarId !== undefined && value.calendarId !== 'iso8601') {
    throw errorTemporalNonIsoCalendar(identity.codecId, value.calendarId);
  }
  return value.toString();
}

const DATE_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_DATE_TEMPORAL_CODEC_ID,
  stringType: 'DateString',
};
const TIMESTAMP_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  stringType: 'TimestampString(p)',
};
const TIMESTAMPTZ_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  stringType: 'TimestamptzString(p)',
};
const TIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: PG_TIME_TEMPORAL_CODEC_ID,
  stringType: 'TimeString(p)',
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
