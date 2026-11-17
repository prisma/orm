/**
 * Shared encode/decode/render constants for the Postgres target codecs.
 *
 * The codec implementations live in `codecs.ts` (TML-2357); the temporal codecs and the helpers
 * they alone use live in `temporal-codecs.ts`, `temporal-string-codecs.ts` and
 * `temporal-codec-helpers.ts`. This file retains the conversion helpers + emit-path type renderers that the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 *
 * Trivial identity passthroughs are inlined directly in the codec methods; only conversions with shape (custom JSON round-trip, decode normalisation, parameterised renderers) live here.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  numeralText,
  readJsonIntegerText,
  SAFE_INTEGER_BIGINT_RANGE,
} from '@internal/framework-components/codec';
import { ISO_DURATION } from '@internal/type-implementations/duration';
import {
  BYTEA_TEXT,
  formatIsoDuration,
  intervalFieldsOf,
  MICROS_PER_SECOND,
  microsFromFraction,
  type PgInterval,
  postgresIntervalFields,
} from './data-type-values';
import { postgresError } from './errors';

export type PrecisionParams = { readonly precision?: number };

/**
 * A `numeric` value as its canonical decimal text. A number is written out without an exponent,
 * because `numeric` text has no exponent syntax and `toDataTypeValue` refuses one.
 */
export const pgNumericDecode = (wire: string | number): string => {
  if (typeof wire === 'number') return numeralText(wire);
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
export const pgBigintDigits = (codecId: string, value: bigint | number): string => {
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

/**
 * A SQL number literal has no form for `NaN` or the infinities; PostgreSQL reads and writes them as
 * the text `NaN`, `Infinity`, `-Infinity`, so the float codecs carry them as that text on the wire,
 * as `floatToJson` does in JSON.
 */
export const pgFloatEncode = (value: number): string | number =>
  Number.isFinite(value) ? value : String(value);

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

export const pgInt8NumberEncode = (value: number): string => {
  requireJsType('pg/int8number@1', 'number', value);
  return String(pgInt8NumberGuard('RUNTIME.ENCODE_FAILED', value));
};

/**
 * Reads an `int8` wire value as a `number`, throwing outside ±(2^53 − 1) and on
 * non-integral input. Decimal text goes through `BigInt` before the range check
 * so an out-of-range value is compared exactly rather than after rounding.
 */
export const pgInt8NumberDecode = (wire: string | number | bigint): number => {
  if (typeof wire === 'number') return pgInt8NumberGuard('RUNTIME.DECODE_FAILED', wire);
  const value = decimalIntegerDecode('pg/int8number@1', wire);
  if (value < SAFE_INTEGER_BIGINT_RANGE.min || value > SAFE_INTEGER_BIGINT_RANGE.max) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `pg/int8number@1 value must be an integer within the safe integer range, got ${value}`,
      { meta: { codecId: 'pg/int8number@1', received: value.toString() } },
    );
  }
  return Number(value);
};

/** A `number` holds an integer exactly only within the safe integer range, so digit text past it is refused. */
export const pgInt8NumberFromDigits = (digits: JsonValue): number =>
  Number(readJsonIntegerText('pg/int8number@1', digits, SAFE_INTEGER_BIGINT_RANGE));

/** Parses an ISO-8601 duration into the application value. */
export const pgIntervalFromIso = (text: string): PgInterval => intervalFieldsOf(text);

/** Renders the application value as its canonical ISO-8601 duration. */
export const pgIntervalToIso = (value: PgInterval): string => formatIsoDuration(value);

const ZERO_INTERVAL: PgInterval = { months: 0, days: 0, micros: 0n };

/** `count` with the sign `negative` gives it, never `-0`. */
const signed = (negative: boolean, count: number): number =>
  negative && count !== 0 ? -count : count;

const negated = ({ months, days, micros }: PgInterval): PgInterval => ({
  months: signed(true, months),
  days: signed(true, days),
  micros: -micros,
});

/** Hours, minutes, seconds and a fraction of a second, with one sign for all of them. */
function timeMicros(
  negative: boolean,
  hours: string,
  minutes: string,
  seconds: string,
  fraction: string,
): bigint {
  const magnitude =
    (BigInt(hours) * 3_600n + BigInt(minutes) * 60n + BigInt(seconds)) * MICROS_PER_SECOND +
    microsFromFraction(fraction, negative);
  return negative ? -magnitude : magnitude;
}

const VERBOSE_FIELD = /^(-?)(\d+)(?:\.(\d+))? (year|mon|day|hour|min|sec)s?$/;

/**
 * An interval as PostgreSQL prints it under `IntervalStyle = 'postgres_verbose'`: `@ 1 year 2 mons
 * -3 days 4 hours 5 mins 6.5 secs`, each field with its own sign, and ` ago` negating the whole; `@ 0`
 * for zero.
 */
function verboseIntervalFields(text: string): PgInterval | undefined {
  if (!text.startsWith('@ ')) return undefined;
  const ago = text.endsWith(' ago');
  const body = text.slice(2, ago ? -4 : undefined);
  if (body === '0') return ZERO_INTERVAL;
  const words = body.split(' ');
  if (words.length === 0 || words.length % 2 !== 0) return undefined;
  let months = 0;
  let days = 0;
  let micros = 0n;
  for (let index = 0; index < words.length; index += 2) {
    const match = VERBOSE_FIELD.exec(`${words[index]} ${words[index + 1]}`);
    if (match === null) return undefined;
    const [, sign = '', whole = '0', fraction, unit] = match;
    if (fraction !== undefined && unit !== 'sec') return undefined;
    const negative = sign === '-';
    const count = signed(negative, Number(whole));
    if (unit === 'year') months += count * 12;
    else if (unit === 'mon') months += count;
    else if (unit === 'day') days += count;
    else if (unit === 'hour') micros += BigInt(count) * 3_600n * MICROS_PER_SECOND;
    else if (unit === 'min') micros += BigInt(count) * 60n * MICROS_PER_SECOND;
    else micros += timeMicros(negative, '0', '0', whole, fraction ?? '');
  }
  const fields = { months, days, micros };
  return ago ? negated(fields) : fields;
}

const SQL_MIXED = /^([+-])(\d+)-(\d+) ([+-])(\d+) ([+-])(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const SQL_YEAR_MONTH = /^(-?)(\d+)-(\d+)$/;
const SQL_DAY_TIME = /^(-?)(?:(\d+) )?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * An interval as PostgreSQL prints it under `IntervalStyle = 'sql_standard'`. A value with fields of
 * one sign and of one kind, year-month or day-time, has a single leading sign for all of them:
 * `-1-2`, `-1 2:03:04`, `-0:00:01.5`. Any other value signs each part: `+1-2 -3 +4:05:06.5`. Zero is
 * `0`.
 */
function sqlStandardIntervalFields(text: string): PgInterval | undefined {
  if (text === '0') return ZERO_INTERVAL;
  const mixed = SQL_MIXED.exec(text);
  if (mixed !== null) {
    const [, yearSign, years = '0', months = '0', daySign, days = '0', timeSign] = mixed;
    const monthCount = Number(years) * 12 + Number(months);
    return {
      months: signed(yearSign === '-', monthCount),
      days: signed(daySign === '-', Number(days)),
      micros: timeMicros(
        timeSign === '-',
        mixed[7] ?? '0',
        mixed[8] ?? '0',
        mixed[9] ?? '0',
        mixed[10] ?? '',
      ),
    };
  }
  const yearMonth = SQL_YEAR_MONTH.exec(text);
  if (yearMonth !== null) {
    const [, sign, years = '0', months = '0'] = yearMonth;
    const monthCount = Number(years) * 12 + Number(months);
    return { months: signed(sign === '-', monthCount), days: 0, micros: 0n };
  }
  const dayTime = SQL_DAY_TIME.exec(text);
  if (dayTime === null) return undefined;
  const [, sign, days = '0', hours = '0', minutes = '0', seconds = '0', fraction = ''] = dayTime;
  const negative = sign === '-';
  return {
    months: 0,
    days: signed(negative, Number(days)),
    micros: timeMicros(negative, hours, minutes, seconds, fraction),
  };
}

/** Reads the interval text PostgreSQL prints under any `IntervalStyle`. */
export const intervalTextFields = (text: string): PgInterval => {
  const fields = ISO_DURATION.test(text)
    ? intervalFieldsOf(text)
    : (postgresIntervalFields(text) ??
      verboseIntervalFields(text) ??
      sqlStandardIntervalFields(text));
  if (fields === undefined) {
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `pg/interval@1 value must be interval text PostgreSQL prints under an IntervalStyle, got ${text}`,
      { meta: { codecId: 'pg/interval@1', received: text } },
    );
  }
  return fields;
};

export const pgIntervalDecode = (wire: string | Record<string, unknown>): PgInterval => {
  if (typeof wire === 'string') return intervalTextFields(wire);
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

export const pgByteaToBase64 = (value: Uint8Array): string => Buffer.from(value).toString('base64');

export const pgByteaFromBase64 = (base64: string): Uint8Array =>
  new Uint8Array(Buffer.from(base64, 'base64'));

/** The text PostgreSQL prints for `bytea` under `bytea_output = 'escape'`: `\\` for a backslash, `\nnn` in octal for a byte outside printable ASCII, and every other byte as itself. */
const BYTEA_ESCAPE_TEXT = /^(?:[ -[\]-~]|\\\\|\\[0-3][0-7]{2})*$/;
const BYTEA_ESCAPE = /\\\\|\\([0-3][0-7]{2})|[ -[\]-~]/g;

function byteaOfEscapeText(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const [token, octal] of text.matchAll(BYTEA_ESCAPE)) {
    bytes.push(
      octal !== undefined
        ? Number.parseInt(octal, 8)
        : token === '\\\\'
          ? 0x5c
          : token.charCodeAt(0),
    );
  }
  return Uint8Array.from(bytes);
}

export const pgByteaDecodeWire = (wire: Uint8Array | string): Uint8Array => {
  if (wire instanceof Uint8Array) {
    return wire.constructor === Uint8Array
      ? wire
      : new Uint8Array(wire.buffer, wire.byteOffset, wire.byteLength);
  }
  if (BYTEA_TEXT.test(wire)) return new Uint8Array(Buffer.from(wire.slice(2), 'hex'));
  if (!wire.startsWith('\\x') && BYTEA_ESCAPE_TEXT.test(wire)) return byteaOfEscapeText(wire);
  throw postgresError(
    'RUNTIME.DECODE_FAILED',
    "pg/bytea@1 wire value must be a Uint8Array or bytea text, as PostgreSQL prints it under bytea_output 'hex' or 'escape'",
    { meta: { codecId: 'pg/bytea@1', received: wire } },
  );
};

const parseJsonWire: (text: string) => JsonValue = JSON.parse;

export const pgJsonEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? parseJsonWire(wire) : wire;

export const pgJsonbEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonbDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? parseJsonWire(wire) : wire;
