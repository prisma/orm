/**
 * The codecs of MySQL's date and time types other than `mysql/datetime@1`. Every instant is read and written in UTC, which every session runs in. A string codec reads the ISO 8601 text of its value with no trailing zeros in the fraction, as PostgreSQL's do; a `Temporal` codec reads `Temporal.Instant`, `Temporal.PlainDate` or `Temporal.PlainTime`. A write of a value MySQL does not hold, such as a date before the year 1000 or a `time` past 23:59:59.999999, is refused. A read takes what MySQL returns in any year; only the `time` codecs refuse a row, one that is no time of day. ADR 315.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
  dateTimeStoredText,
  refuseJsonValue,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { hasDigitsBelowAMillisecond } from '@internal/type-implementations/date';
import type { Temporal } from 'temporal-spec';
import { identityJsonProjection, MysqlCodecDescriptor } from './codec-descriptor';
import {
  MYSQL_DATE_STRING_CODEC_ID,
  MYSQL_DATE_TEMPORAL_CODEC_ID,
  MYSQL_DATETIME_STRING_CODEC_ID,
  MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  MYSQL_DURATION_STRING_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  mysqlDate,
  mysqlDateText,
  mysqlDatetime,
  mysqlDatetimeParams,
  mysqlDatetimeText,
  mysqlDuration,
  mysqlDurationText,
  mysqlTime,
  mysqlTimestamp,
  mysqlTimestampText,
  mysqlTimeText,
} from './data-types';
import {
  dateOfWireText,
  mysqlWireText,
  type StoredText,
  storedTextForWrite,
  storedTextFromWire,
  storedTextOfTemporal,
  type TemporalCodecIdentity,
  temporalFromStoredText,
  utcDateTimeOfInstantText,
  wireTextOfDate,
} from './date-time-values';

type PrecisionParams = typeof mysqlDatetimeParams.infer;

/** The stored form of an instant written as ISO 8601 text with a UTC offset: its UTC date and time, in the form `stored` writes. */
const instantIn =
  (codecId: string, stored: StoredText): StoredText =>
  (text) =>
    utcDateTimeOfInstantText(codecId, text, stored);

/** Reads the text MySQL returns for a row in any year: a column's range is refused on write only. */
const anyYear =
  (ownerId: string, shape: 'dateTime' | 'date'): StoredText =>
  (text) =>
    dateTimeStoredText(text, { shape, ownerId });

const datetimeRow = anyYear(mysqlDatetime.id, 'dateTime');
const timestampRow = anyYear(mysqlTimestamp.id, 'dateTime');
const dateRow = anyYear(mysqlDate.id, 'date');

const DATETIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.Instant',
  stringType: 'DatetimeString',
};
const TIMESTAMP_TEMPORAL: TemporalCodecIdentity = {
  codecId: MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.Instant',
  stringType: 'TimestampString',
};
const DATE_TEMPORAL: TemporalCodecIdentity = {
  codecId: MYSQL_DATE_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainDate',
  stringType: 'DateString',
};
const TIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: MYSQL_TIME_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainTime',
  stringType: 'TimeString',
};

const instantOf = (identity: TemporalCodecIdentity, stored: string): Temporal.Instant =>
  temporalFromStoredText(identity, `${stored}Z`, (temporal, text) => temporal.Instant.from(text));

/** A MySQL `timestamp` as a JavaScript `Date`, read and written in UTC. */
export class MysqlTimestampDateCodec extends CodecImpl<
  typeof MYSQL_TIMESTAMP_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async toWire(value: Date, _ctx: CodecCallContext): Promise<string> {
    return wireTextOfDate(this.id, value, mysqlTimestampText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return dateOfWireText(this.id, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Date {
    if (hasDigitsBelowAMillisecond(value.value)) {
      return refuseJsonValue(
        this.id,
        `a timestamp with no digits below a millisecond, which a Date drops: ${JSON.stringify(value.value)} has them`,
        value.value,
      );
    }
    return new Date(`${value.value}Z`);
  }
  toDataTypeValue(input: Date): DataTypeValue {
    return this.dataTypeValueOf(input.toISOString().replace('Z', ''));
  }
}

export class MysqlTimestampDateDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlTimestamp.id;
  override readonly codecId = MYSQL_TIMESTAMP_DATE_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => MysqlTimestampDateCodec {
    return () => new MysqlTimestampDateCodec(this, mysqlTimestamp, params);
  }
}

export const mysqlTimestampDateDescriptor = new MysqlTimestampDateDescriptor();

/** An instant read as `Temporal.Instant` from a `datetime` that holds it in UTC. */
export class MysqlDatetimeTemporalCodec extends CodecImpl<
  typeof MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async toWire(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return mysqlWireText(this.stored(value));
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return instantOf(DATETIME_TEMPORAL, storedTextFromWire(this.id, wire, datetimeRow));
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.Instant {
    return instantOf(DATETIME_TEMPORAL, value.value);
  }
  toDataTypeValue(input: Temporal.Instant): DataTypeValue {
    return this.dataTypeValueOf(this.stored(input));
  }
  private stored(value: Temporal.Instant): string {
    return storedTextOfTemporal(DATETIME_TEMPORAL, value, instantIn(this.id, mysqlDatetimeText));
  }
}

export class MysqlDatetimeTemporalDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlDatetime.id;
  override readonly codecId = MYSQL_DATETIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => MysqlDatetimeTemporalCodec {
    return () => new MysqlDatetimeTemporalCodec(this, mysqlDatetime, params);
  }
}

export const mysqlDatetimeTemporalDescriptor = new MysqlDatetimeTemporalDescriptor();

/** An instant read as `Temporal.Instant` from a `timestamp`. */
export class MysqlTimestampTemporalCodec extends CodecImpl<
  typeof MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async toWire(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return mysqlWireText(this.stored(value));
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return instantOf(TIMESTAMP_TEMPORAL, storedTextFromWire(this.id, wire, timestampRow));
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.Instant {
    return instantOf(TIMESTAMP_TEMPORAL, value.value);
  }
  toDataTypeValue(input: Temporal.Instant): DataTypeValue {
    return this.dataTypeValueOf(this.stored(input));
  }
  private stored(value: Temporal.Instant): string {
    return storedTextOfTemporal(TIMESTAMP_TEMPORAL, value, instantIn(this.id, mysqlTimestampText));
  }
}

export class MysqlTimestampTemporalDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlTimestamp.id;
  override readonly codecId = MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => MysqlTimestampTemporalCodec {
    return () => new MysqlTimestampTemporalCodec(this, mysqlTimestamp, params);
  }
}

export const mysqlTimestampTemporalDescriptor = new MysqlTimestampTemporalDescriptor();

/** The literal of the instant text a string codec reads from a stored date and time, which has no offset. */
function renderInstantTextLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' ? renderTsLiteral(`${value}Z`) : undefined;
}

/** An instant read as ISO 8601 text in UTC, `2024-01-01T00:00:00.5Z`, from a `datetime`. A write takes ISO 8601 text with any UTC offset. */
export class MysqlDatetimeStringCodec extends CodecImpl<
  typeof MYSQL_DATETIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return mysqlWireText(storedTextForWrite(this.id, value, instantIn(this.id, mysqlDatetimeText)));
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return `${storedTextFromWire(this.id, wire, datetimeRow)}Z`;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return `${value.value}Z`;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(instantIn(this.id, mysqlDatetimeText)(input));
  }
}

export class MysqlDatetimeStringDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlDatetime.id;
  override readonly codecId = MYSQL_DATETIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderInstantTextLiteral(value);
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => MysqlDatetimeStringCodec {
    return () => new MysqlDatetimeStringCodec(this, mysqlDatetime, params);
  }
}

export const mysqlDatetimeStringDescriptor = new MysqlDatetimeStringDescriptor();

/** An instant read as ISO 8601 text in UTC, `2024-01-01T00:00:00.5Z`, from a `timestamp`. A write takes ISO 8601 text with any UTC offset. */
export class MysqlTimestampStringCodec extends CodecImpl<
  typeof MYSQL_TIMESTAMP_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return mysqlWireText(
      storedTextForWrite(this.id, value, instantIn(this.id, mysqlTimestampText)),
    );
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return `${storedTextFromWire(this.id, wire, timestampRow)}Z`;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return `${value.value}Z`;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(instantIn(this.id, mysqlTimestampText)(input));
  }
}

export class MysqlTimestampStringDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlTimestamp.id;
  override readonly codecId = MYSQL_TIMESTAMP_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderInstantTextLiteral(value);
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => MysqlTimestampStringCodec {
    return () => new MysqlTimestampStringCodec(this, mysqlTimestamp, params);
  }
}

export const mysqlTimestampStringDescriptor = new MysqlTimestampStringDescriptor();

/** A calendar date read as ISO 8601 text, `2024-02-29`. */
export class MysqlDateStringCodec extends CodecImpl<
  typeof MYSQL_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, mysqlDateText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, dateRow);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class MysqlDateStringDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlDate.id;
  override readonly codecId = MYSQL_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlDateStringCodec {
    return () => new MysqlDateStringCodec(this, mysqlDate);
  }
}

export const mysqlDateStringDescriptor = new MysqlDateStringDescriptor();

/** A calendar date read as `Temporal.PlainDate`. */
export class MysqlDateTemporalCodec extends CodecImpl<
  typeof MYSQL_DATE_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDate
> {
  async toWire(value: Temporal.PlainDate, _ctx: CodecCallContext): Promise<string> {
    return storedTextOfTemporal(DATE_TEMPORAL, value, mysqlDateText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDate> {
    return this.plainDateOf(storedTextFromWire(this.id, wire, dateRow));
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainDate {
    return this.plainDateOf(value.value);
  }
  toDataTypeValue(input: Temporal.PlainDate): DataTypeValue {
    return this.dataTypeValueOf(storedTextOfTemporal(DATE_TEMPORAL, input, mysqlDateText));
  }
  private plainDateOf(stored: string): Temporal.PlainDate {
    return temporalFromStoredText(DATE_TEMPORAL, stored, (temporal, text) =>
      temporal.PlainDate.from(text),
    );
  }
}

export class MysqlDateTemporalDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlDate.id;
  override readonly codecId = MYSQL_DATE_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlDateTemporalCodec {
    return () => new MysqlDateTemporalCodec(this, mysqlDate);
  }
}

export const mysqlDateTemporalDescriptor = new MysqlDateTemporalDescriptor();

/** A time of day read as ISO 8601 text, `09:30:00.5`. A MySQL `time` outside 00:00:00 to 23:59:59.999999 is no time of day, so it is refused on read and on write. */
export class MysqlTimeStringCodec extends CodecImpl<
  typeof MYSQL_TIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, mysqlTimeText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, mysqlTimeText);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class MysqlTimeStringDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlTime.id;
  override readonly codecId = MYSQL_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => MysqlTimeStringCodec {
    return () => new MysqlTimeStringCodec(this, mysqlTime, params);
  }
}

export const mysqlTimeStringDescriptor = new MysqlTimeStringDescriptor();

/** A time of day read as `Temporal.PlainTime`. */
export class MysqlTimeTemporalCodec extends CodecImpl<
  typeof MYSQL_TIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainTime
> {
  async toWire(value: Temporal.PlainTime, _ctx: CodecCallContext): Promise<string> {
    return storedTextOfTemporal(TIME_TEMPORAL, value, mysqlTimeText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainTime> {
    return this.plainTimeOf(storedTextFromWire(this.id, wire, mysqlTimeText));
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainTime {
    return this.plainTimeOf(value.value);
  }
  toDataTypeValue(input: Temporal.PlainTime): DataTypeValue {
    return this.dataTypeValueOf(storedTextOfTemporal(TIME_TEMPORAL, input, mysqlTimeText));
  }
  private plainTimeOf(stored: string): Temporal.PlainTime {
    return temporalFromStoredText(TIME_TEMPORAL, stored, (temporal, text) =>
      temporal.PlainTime.from(text),
    );
  }
}

export class MysqlTimeTemporalDescriptor extends MysqlCodecDescriptor<PrecisionParams> {
  override readonly dataType = mysqlTime.id;
  override readonly codecId = MYSQL_TIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = mysqlDatetimeParams;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => MysqlTimeTemporalCodec {
    return () => new MysqlTimeTemporalCodec(this, mysqlTime, params);
  }
}

export const mysqlTimeTemporalDescriptor = new MysqlTimeTemporalDescriptor();

/** A length of time read as the ISO 8601 duration it was written as, `PT1H30M`, stored in a `text` column. Its text does not sort in the order of the durations, so it offers no order. */
export class MysqlDurationStringCodec extends CodecImpl<
  typeof MYSQL_DURATION_STRING_CODEC_ID,
  readonly ['equality'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, mysqlDurationText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, mysqlDurationText);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class MysqlDurationStringDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlDuration.id;
  override readonly codecId = MYSQL_DURATION_STRING_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlDurationStringCodec {
    return () => new MysqlDurationStringCodec(this, mysqlDuration);
  }
}

export const mysqlDurationStringDescriptor = new MysqlDurationStringDescriptor();
