/**
 * The codecs of MongoDB's date and time types other than `mongo/date@1`. An instant and a calendar date are BSON dates, a calendar date at midnight UTC, the form MongoDB's Java and C# drivers write for a date; a time of day is a BSON string with three fraction digits, which sorts in the order of the times; a duration is a BSON string as written. ADR 315.
 */

import type { JsonValue } from '@internal/contract/types';
import { type DataTypeValue, renderTsLiteral } from '@internal/framework-components/codec';
import { mongoCodec } from '@internal/mongo-codec';
import type { Temporal } from 'temporal-spec';
import {
  MONGO_DATE_INSTANT_CODEC_ID,
  MONGO_DATE_INSTANT_STRING_CODEC_ID,
  MONGO_DATE_STRING_CODEC_ID,
  MONGO_DATE_TEMPORAL_CODEC_ID,
  MONGO_DURATION_STRING_CODEC_ID,
  MONGO_TIME_STRING_CODEC_ID,
  MONGO_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  mongoCalendarDateText,
  mongoDate,
  mongoDuration,
  mongoDurationText,
  mongoInstantText,
  mongoTime,
  mongoTimeText,
} from './data-types';
import { errorCalendarDateNotAtMidnight } from './date-time-errors';
import {
  calendarDateFromWire,
  calendarDateTextOf,
  dateFromWire,
  isAtMidnightUtc,
  midnightUtcOf,
  storedTextForWrite,
  storedTextFromWire,
  storedTextOfTemporal,
  type TemporalCodecIdentity,
  temporalFromStoredText,
} from './date-time-values';

const INSTANT: TemporalCodecIdentity = {
  codecId: MONGO_DATE_INSTANT_CODEC_ID,
  temporalTag: 'Temporal.Instant',
  stringType: 'DateInstantString',
};
const PLAIN_DATE: TemporalCodecIdentity = {
  codecId: MONGO_DATE_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainDate',
  stringType: 'DateString',
};
const PLAIN_TIME: TemporalCodecIdentity = {
  codecId: MONGO_TIME_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainTime',
  stringType: 'TimeString',
};

/** The calendar date a contract's `mongo/date` value holds, which must be at midnight UTC. */
function calendarDateOfDataTypeValue(codecId: string, value: DataTypeValue<string>): string {
  const date = new Date(value.value);
  if (!isAtMidnightUtc(date)) throw errorCalendarDateNotAtMidnight(codecId, value.value);
  return calendarDateTextOf(date);
}

/** A calendar date as a TypeScript literal of the date text the application reads. */
export function renderCalendarDateLiteral(value: JsonValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return isAtMidnightUtc(date) ? renderTsLiteral(calendarDateTextOf(date)) : undefined;
}

const instantText = (value: Temporal.Instant): string =>
  storedTextOfTemporal(INSTANT, value, mongoInstantText);

const plainDateText = (value: Temporal.PlainDate): string =>
  storedTextOfTemporal(PLAIN_DATE, value, mongoCalendarDateText);

const plainTimeText = (value: Temporal.PlainTime): string =>
  storedTextOfTemporal(PLAIN_TIME, value, mongoTimeText);

/** An instant, stored as a BSON date and read as `Temporal.Instant`. */
export const mongoDateInstantCodec = mongoCodec({
  typeId: MONGO_DATE_INSTANT_CODEC_ID,
  dataType: mongoDate,
  fromWire: (wire: Date) =>
    temporalFromStoredText(
      INSTANT,
      dateFromWire(MONGO_DATE_INSTANT_CODEC_ID, wire).toISOString(),
      (temporal, text) => temporal.Instant.from(text),
    ),
  toWire: (value: Temporal.Instant) => new Date(instantText(value)),
  toDataTypeValue: (value: Temporal.Instant) => mongoDate.valueFrom(instantText(value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) =>
    temporalFromStoredText(INSTANT, value.value, (temporal, text) => temporal.Instant.from(text)),
});

/** An instant, stored as a BSON date and read as the text `Date.toISOString()` writes, `2024-01-01T00:00:00.000Z`. A write takes ISO 8601 text with any UTC offset. */
export const mongoDateInstantStringCodec = mongoCodec({
  typeId: MONGO_DATE_INSTANT_STRING_CODEC_ID,
  dataType: mongoDate,
  fromWire: (wire: Date) => dateFromWire(MONGO_DATE_INSTANT_STRING_CODEC_ID, wire).toISOString(),
  toWire: (value: string) =>
    new Date(storedTextForWrite(MONGO_DATE_INSTANT_STRING_CODEC_ID, value, mongoInstantText)),
  toDataTypeValue: (value: string) =>
    mongoDate.valueFrom(
      storedTextForWrite(MONGO_DATE_INSTANT_STRING_CODEC_ID, value, mongoInstantText),
      {},
    ),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

/** A calendar date, stored as a BSON date at midnight UTC and read as `2024-02-29`. */
export const mongoDateStringCodec = mongoCodec({
  typeId: MONGO_DATE_STRING_CODEC_ID,
  dataType: mongoDate,
  fromWire: (wire: Date) => calendarDateFromWire(MONGO_DATE_STRING_CODEC_ID, wire),
  toWire: (value: string) =>
    midnightUtcOf(storedTextForWrite(MONGO_DATE_STRING_CODEC_ID, value, mongoCalendarDateText)),
  toDataTypeValue: (value: string) =>
    mongoDate.valueFrom(
      midnightUtcOf(
        storedTextForWrite(MONGO_DATE_STRING_CODEC_ID, value, mongoCalendarDateText),
      ).toISOString(),
      {},
    ),
  fromDataTypeValue: (value: DataTypeValue<string>) =>
    calendarDateOfDataTypeValue(MONGO_DATE_STRING_CODEC_ID, value),
});

/** A calendar date, stored as a BSON date at midnight UTC and read as `Temporal.PlainDate`. */
export const mongoDateTemporalCodec = mongoCodec({
  typeId: MONGO_DATE_TEMPORAL_CODEC_ID,
  dataType: mongoDate,
  fromWire: (wire: Date) =>
    temporalFromStoredText(
      PLAIN_DATE,
      calendarDateFromWire(MONGO_DATE_TEMPORAL_CODEC_ID, wire),
      (temporal, text) => temporal.PlainDate.from(text),
    ),
  toWire: (value: Temporal.PlainDate) => midnightUtcOf(plainDateText(value)),
  toDataTypeValue: (value: Temporal.PlainDate) =>
    mongoDate.valueFrom(midnightUtcOf(plainDateText(value)).toISOString(), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) =>
    temporalFromStoredText(
      PLAIN_DATE,
      calendarDateOfDataTypeValue(MONGO_DATE_TEMPORAL_CODEC_ID, value),
      (temporal, text) => temporal.PlainDate.from(text),
    ),
});

/** A time of day, stored as a BSON string and read as that string, `09:30:00.000`. A write pads a string with fewer fraction digits to three. */
export const mongoTimeStringCodec = mongoCodec({
  typeId: MONGO_TIME_STRING_CODEC_ID,
  dataType: mongoTime,
  fromWire: (wire: string) => storedTextFromWire(MONGO_TIME_STRING_CODEC_ID, wire, mongoTimeText),
  toWire: (value: string) => storedTextForWrite(MONGO_TIME_STRING_CODEC_ID, value, mongoTimeText),
  toDataTypeValue: (value: string) =>
    mongoTime.valueFrom(storedTextForWrite(MONGO_TIME_STRING_CODEC_ID, value, mongoTimeText), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

/** A time of day, stored as a BSON string, `09:30:00.000`, and read as `Temporal.PlainTime`. */
export const mongoTimeTemporalCodec = mongoCodec({
  typeId: MONGO_TIME_TEMPORAL_CODEC_ID,
  dataType: mongoTime,
  fromWire: (wire: string) =>
    temporalFromStoredText(
      PLAIN_TIME,
      storedTextFromWire(MONGO_TIME_TEMPORAL_CODEC_ID, wire, mongoTimeText),
      (temporal, text) => temporal.PlainTime.from(text),
    ),
  toWire: (value: Temporal.PlainTime) => plainTimeText(value),
  toDataTypeValue: (value: Temporal.PlainTime) => mongoTime.valueFrom(plainTimeText(value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) =>
    temporalFromStoredText(PLAIN_TIME, value.value, (temporal, text) =>
      temporal.PlainTime.from(text),
    ),
});

/** A length of time, stored as a BSON string and read as the ISO 8601 duration it was written as, `PT1H30M`. */
export const mongoDurationStringCodec = mongoCodec({
  typeId: MONGO_DURATION_STRING_CODEC_ID,
  dataType: mongoDuration,
  fromWire: (wire: string) =>
    storedTextFromWire(MONGO_DURATION_STRING_CODEC_ID, wire, mongoDurationText),
  toWire: (value: string) =>
    storedTextForWrite(MONGO_DURATION_STRING_CODEC_ID, value, mongoDurationText),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});
