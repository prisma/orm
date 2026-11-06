import { refuseJsonValue } from '@internal/framework-components/codec';
import { utcIsoTextOf } from '@internal/type-implementations/date';
import type { TemporalImplementation } from '@internal/type-implementations/temporal';
import {
  type TemporalTag,
  type TemporalValue,
  temporalFromText,
  temporalToText,
  withoutUtcDesignator,
} from '@internal/type-implementations/temporal-text';
import type { Temporal } from 'temporal-spec';
import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_INSTANT_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { pgTimestampStoredText } from './data-types';
import { requireIsoDateStyle } from './date-time-wire-text';
import {
  errorTemporalNonIsoCalendar,
  errorTemporalUnrepresentable,
  errorTemporalWrongType,
} from './errors';
import { isoYearText, postgresYearText } from './postgres-year-text';
import { requireTemporal } from './require-temporal';

const POSTGRES_TEMPORAL_SENTINELS: ReadonlySet<string> = new Set(['infinity', '-infinity']);

/** The Temporal types whose text PostgreSQL prints the same in every DateStyle, because it holds no date. Every other Temporal codec reads a date, so its text is refused unless PostgreSQL printed it under DateStyle ISO. */
const TEMPORAL_TAGS_WITHOUT_A_DATE: ReadonlySet<TemporalTag> = new Set(['Temporal.PlainTime']);

interface TemporalCodecIdentity {
  readonly codecId: string;
  readonly stringType: string;
  readonly temporalTag: TemporalTag;
}

function decodeTemporalText<T>(
  identity: TemporalCodecIdentity,
  wire: string,
  parse: (temporal: TemporalImplementation, text: string) => T,
): T {
  const temporal = requireTemporal({ codecId: identity.codecId, operation: 'decode' });
  if (!TEMPORAL_TAGS_WITHOUT_A_DATE.has(identity.temporalTag)) {
    requireIsoDateStyle(identity.codecId, wire);
  }
  if (POSTGRES_TEMPORAL_SENTINELS.has(wire)) {
    throw errorTemporalUnrepresentable({
      ...identity,
      operation: 'decode',
      value: wire,
      detail: `PostgreSQL's ${wire} is a sentinel with no position on the timeline, so no Temporal value denotes it`,
    });
  }
  const read = temporalFromText(temporal, wire, (implementation, text) =>
    parse(implementation, isoYearText(text)),
  );
  if (read.kind === 'unreadable') {
    throw errorTemporalUnrepresentable({
      ...identity,
      operation: 'decode',
      value: wire,
      detail: read.detail,
      cause: read.cause,
    });
  }
  return read.value;
}

function encodeTemporalValue(
  identity: TemporalCodecIdentity,
  value: TemporalValue,
  isoText?: (value: TemporalValue) => string,
): string {
  const encoded = temporalToText(value, identity.temporalTag, isoText);
  switch (encoded.kind) {
    case 'wrong-type':
      throw errorTemporalWrongType(
        identity.codecId,
        identity.temporalTag,
        identity.stringType,
        encoded.received,
      );
    case 'non-iso-calendar':
      throw errorTemporalNonIsoCalendar(identity.codecId, encoded.calendarId);
    case 'text':
      return postgresYearText(encoded.text);
  }
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
const TIMESTAMP_INSTANT: TemporalCodecIdentity = {
  codecId: PG_TIMESTAMP_INSTANT_CODEC_ID,
  stringType: 'TimestampString(p)',
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

/** Reads a timestamp without a time zone as the instant it names in UTC. */
export const pgTimestampInstantDecode = (wire: string): Temporal.Instant =>
  decodeTemporalText(TIMESTAMP_INSTANT, wire, (temporal, text) =>
    temporal.Instant.from(`${pgTimestampStoredText(text)}Z`),
  );

/** Writes an instant as its UTC date and time, with no offset, as a timestamp without a time zone holds it. */
export const pgTimestampInstantEncode = (value: Temporal.Instant): string =>
  encodeTemporalValue(TIMESTAMP_INSTANT, value, (instant) =>
    withoutUtcDesignator(instant.toString()),
  );

export const pgTimeTemporalDecode = (wire: string): Temporal.PlainTime =>
  decodeTemporalText(TIME_TEMPORAL, wire, (temporal, text) => temporal.PlainTime.from(text));

export const pgTimeTemporalEncode = (value: Temporal.PlainTime): string =>
  encodeTemporalValue(TIME_TEMPORAL, value);

export const EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS = new Date(
  '-004713-11-24T00:00:00Z',
).getTime();

function utcIsoText(value: Date, codecId: string): string {
  const text = utcIsoTextOf(value, EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS);
  if (text === undefined) {
    throw new RangeError(
      `${codecId} writes a Date as UTC text and needs a valid Date on or after 4714-11-24 BC, the earliest timestamp PostgreSQL holds; got ${String(value)}`,
    );
  }
  return text;
}

export function utcTimestamptzText(value: Date, codecId: string): string {
  return postgresYearText(utcIsoText(value, codecId));
}

/** The UTC wall-clock time of `value` with no offset, as PostgreSQL reads a timestamp without a time zone. */
export function utcTimestampText(value: Date, codecId: string): string {
  return postgresYearText(withoutUtcDesignator(utcIsoText(value, codecId)));
}
