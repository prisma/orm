/**
 * The values of the Postgres data types: how each type reads, spells and recognises its values (ADR 254). The data types in `data-types.ts` and their authoring entries use these functions, and the codecs import them from here, so a type's rules live with the type.
 */

import type { JsonValue } from '@internal/contract/types';
import { readJsonMatching } from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { withoutTrailing } from '@internal/utils/text';
import { postgresError } from './errors';

/**
 * Whether text fits `length` characters, counted as PostgreSQL counts them: code points. A `character` value is padded with spaces, and spaces past its length are dropped, so they do not count.
 */
export function fitsCharacterLength(text: string, length: number, blankPadded: boolean): boolean {
  const significant = blankPadded ? withoutTrailing(text, ' ') : text;
  return significant.length <= length || [...significant].length <= length;
}

/** The uuid input PostgreSQL reads: 32 hex digits in either case, a hyphen allowed after any group of four but the last, and the whole optionally in braces. */
const UUID_INPUT = /^(?:\{[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}\}|[0-9a-f]{4}(?:-?[0-9a-f]{4}){7})$/i;

/** A UUID as PostgreSQL writes it: lower case, hyphenated 8-4-4-4-12. */
export const STORED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Text in any form PostgreSQL reads as a UUID (either case, a hyphen after any group of four digits, optionally in braces), written the way PostgreSQL writes it; `undefined` for text it does not read as one.
 */
export function storedUuid(text: string): string | undefined {
  if (!UUID_INPUT.test(text)) return undefined;
  const hex = text.replace(/[{}-]/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The largest finite float4. */
export const FLOAT4_MAX = 3.4028234663852886e38;

/** Whether float4 holds a finite number: it neither overflows to an infinity nor rounds to 0, both of which PostgreSQL refuses. */
export function fitsFloat4(value: number): boolean {
  const single = Math.fround(value);
  return Number.isFinite(single) && (value === 0 || single !== 0);
}

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

export const ISO_DURATION =
  /^P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?$/;

export const MICROS_PER_SECOND = 1_000_000n;

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
export const microsFromFraction = (fraction: string, negative: boolean): bigint => {
  if (fraction === '') return 0n;
  const kept = BigInt(fraction.slice(0, 6).padEnd(6, '0'));
  const rest = fraction.slice(6).replace(/0+$/, '');
  if (rest === '') return kept;
  const half = rest[0] === '5' && rest.length === 1;
  const roundsUp = rest > '5' || (half && !negative);
  return roundsUp ? kept + 1n : kept;
};

export const intervalFieldsOf = (text: string): PgInterval => {
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
export const formatIsoDuration = ({ months, days, micros }: PgInterval): string => {
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

/**
 * An interval as PostgreSQL prints it under `IntervalStyle = 'postgres'`: `1 year 2 mons 3 days
 * 04:05:06.5`, `-1 years -2 mons +3 days -04:00:00`, `00:00:00`.
 */
const POSTGRES_INTERVAL =
  /^(?:([+-]?\d+) years? ?)?(?:([+-]?\d+) mons? ?)?(?:([+-]?\d+) days? ?)?(?:([+-])?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?)?$/;

export function postgresIntervalFields(text: string): PgInterval | undefined {
  const match = POSTGRES_INTERVAL.exec(text);
  if (match === null || text === '' || text.endsWith(' ')) return undefined;
  const [, years = '0', months = '0', days = '0', sign, hours = '0', minutes = '0', seconds = '0'] =
    match;
  const fraction = match[8] ?? '';
  const magnitude =
    (BigInt(hours) * 3_600n + BigInt(minutes) * 60n + BigInt(seconds)) * MICROS_PER_SECOND +
    microsFromFraction(fraction, sign === '-');
  return {
    months: Number(years) * 12 + Number(months),
    days: Number(days),
    micros: sign === '-' ? -magnitude : magnitude,
  };
}

function intervalRefused(message: string): never {
  throw structuredError('CONTRACT.CAST_REFUSED', message, {
    why: 'pg/interval stores one form for each interval (ADR 254), and reads ISO 8601 durations and the text PostgreSQL prints.',
    fix: 'Write an ISO 8601 duration, as the message shows.',
  });
}

/**
 * The stored form of `pg/interval` (ADR 254), from an ISO 8601 duration or the text PostgreSQL
 * prints under `IntervalStyle = 'postgres'`.
 */
export function pgIntervalStoredText(text: string): string {
  const fractionDigits = /\.(\d+)/.exec(text)?.[1]?.length ?? 0;
  if (fractionDigits > 6) {
    intervalRefused(
      `"${text}" has ${fractionDigits} digits after the decimal point, but pg/interval holds microseconds, so at most 6. Round it, as in "PT1.123456S".`,
    );
  }
  if (ISO_DURATION.test(text)) return formatIsoDuration(intervalFieldsOf(text));
  const fields = postgresIntervalFields(text);
  if (fields === undefined) {
    intervalRefused(
      `pg/interval cannot read "${text}". Write an ISO 8601 duration, as in "P1Y2M3DT4H5M6S".`,
    );
  }
  return formatIsoDuration(fields);
}

const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Reads base64 with or without padding bits set; {@link spellPgByteaJson} writes the base64 `pg/bytea` stores. */
export const readPgByteaJson = (owner: string, json: JsonValue): JsonValue =>
  readJsonMatching(owner, json, BASE64_TEXT, 'a base64 string');

/** The base64 of the same bytes with padding bits zero, as `Buffer` writes it. */
export const spellPgByteaJson = (json: JsonValue): JsonValue =>
  typeof json === 'string' ? Buffer.from(json, 'base64').toString('base64') : json;

export const BYTEA_TEXT = /^\\x(?:[0-9A-Fa-f]{2})*$/;

/** The base64 `pg/bytea` stores for the hex text PostgreSQL prints, `\x68656c6c6f`. The `bytea` tag reads its body with this. */
export function pgByteaFromHexText(text: string): string {
  if (!BYTEA_TEXT.test(text)) {
    throw structuredError(
      'CONTRACT.CAST_REFUSED',
      `"${text}" is not the hex text PostgreSQL prints for bytea, which is \\x followed by two hexadecimal digits for each byte, as in \\x68656c6c6f.`,
      {
        why: 'The bytea tag reads bytes as the hex text PostgreSQL prints under bytea_output = hex.',
        fix: 'Write the bytes in hex after \\x, as in bytea`\\x68656c6c6f`.',
      },
    );
  }
  return Buffer.from(text.slice(2), 'hex').toString('base64');
}

/** The hex text PostgreSQL prints for the base64 `pg/bytea` stores. */
export function pgByteaHexText(base64: string): string {
  return `\\x${Buffer.from(base64, 'base64').toString('hex')}`;
}
