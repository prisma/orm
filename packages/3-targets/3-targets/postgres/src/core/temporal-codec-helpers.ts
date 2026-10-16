import { refuseJsonValue } from '@internal/framework-components/codec';
import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  errorTemporalNonIsoCalendar,
  errorTemporalUnrepresentable,
  errorTemporalWrongType,
} from './errors';
import { isoYearText, postgresYearText } from './postgres-year-text';
import { requireTemporal, type TemporalImplementation } from './require-temporal';

const POSTGRES_TEMPORAL_SENTINELS: ReadonlySet<string> = new Set(['infinity', '-infinity']);

interface TemporalCodecIdentity {
  readonly codecId: string;
  readonly stringType: string;
  readonly temporalTag: string;
}

function decodeTemporalText<T>(
  identity: TemporalCodecIdentity,
  wire: string,
  parse: (temporal: TemporalImplementation, text: string) => T,
): T {
  const temporal = requireTemporal({ codecId: identity.codecId, operation: 'decode' });
  if (POSTGRES_TEMPORAL_SENTINELS.has(wire)) {
    throw errorTemporalUnrepresentable({
      ...identity,
      operation: 'decode',
      value: wire,
      detail: `PostgreSQL's ${wire} is a sentinel with no position on the timeline, so no Temporal value denotes it`,
    });
  }
  try {
    return parse(temporal, isoYearText(wire));
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
  return postgresYearText(value.toString());
}

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

/** Refuses `infinity` and `-infinity` in a stored value, which no Temporal value or `Date` holds, naming the text codec of the type that does. */
export function refuseInfinity(
  codecId: string,
  holds: string,
  textCodecId: string,
  text: string,
): void {
  if (!POSTGRES_TEMPORAL_SENTINELS.has(text)) return;
  refuseJsonValue(codecId, `${holds}, not infinity or -infinity, which ${textCodecId} holds`, text);
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

export const pgDateTemporalDecode = (wire: string): Temporal.PlainDate =>
  decodeTemporalText(DATE_TEMPORAL, wire, (temporal, text) => temporal.PlainDate.from(text));

export const pgDateTemporalEncode = (value: Temporal.PlainDate): string =>
  encodeTemporalValue(DATE_TEMPORAL, value);

export const pgTimestampTemporalDecode = (wire: string): Temporal.PlainDateTime =>
  decodeTemporalText(TIMESTAMP_TEMPORAL, wire, (temporal, text) =>
    temporal.PlainDateTime.from(text),
  );

export const pgTimestampTemporalEncode = (value: Temporal.PlainDateTime): string =>
  encodeTemporalValue(TIMESTAMP_TEMPORAL, value);

export const pgTimestamptzTemporalDecode = (wire: string): Temporal.Instant =>
  decodeTemporalText(TIMESTAMPTZ_TEMPORAL, wire, (temporal, text) => temporal.Instant.from(text));

export const pgTimestamptzTemporalEncode = (value: Temporal.Instant): string =>
  encodeTemporalValue(TIMESTAMPTZ_TEMPORAL, value);

export const pgTimeTemporalDecode = (wire: string): Temporal.PlainTime =>
  decodeTemporalText(TIME_TEMPORAL, wire, (temporal, text) => temporal.PlainTime.from(text));

export const pgTimeTemporalEncode = (value: Temporal.PlainTime): string =>
  encodeTemporalValue(TIME_TEMPORAL, value);

export const EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS = new Date(
  '-004713-11-24T00:00:00Z',
).getTime();

function utcText(value: Date, codecId: string, zone: '' | 'Z'): string {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS) {
    throw new RangeError(
      `${codecId} writes a Date as UTC text and needs a valid Date on or after 4714-11-24 BC, the earliest timestamp PostgreSQL holds; got ${String(value)}`,
    );
  }
  const iso = value.toISOString();
  return postgresYearText(zone === 'Z' ? iso : iso.slice(0, -1));
}

export const utcTimestampText = (value: Date, codecId: string): string =>
  utcText(value, codecId, '');

export const utcTimestamptzText = (value: Date, codecId: string): string =>
  utcText(value, codecId, 'Z');
