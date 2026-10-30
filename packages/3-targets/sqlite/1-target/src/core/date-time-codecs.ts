/**
 * The codecs of SQLite's date and time types other than `sqlite/datetime@1`. Every one stores text in the form its data type stores, so the column sorts and compares by the text: an instant as `toISOString()` writes it, a date as `2024-02-29`, a time of day with three fraction digits, and a duration as written. ADR 312.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { Temporal } from 'temporal-spec';
import { SqliteCodecDescriptor } from './codec-descriptor';
import {
  SQLITE_DATE_STRING_CODEC_ID,
  SQLITE_DATE_TEMPORAL_CODEC_ID,
  SQLITE_DATETIME_STRING_CODEC_ID,
  SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  SQLITE_DURATION_STRING_CODEC_ID,
  SQLITE_TIME_STRING_CODEC_ID,
  SQLITE_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  sqliteDate,
  sqliteDateText,
  sqliteDatetime,
  sqliteDatetimeTextAtMilliseconds,
  sqliteDuration,
  sqliteDurationText,
  sqliteTime,
  sqliteTimeText,
} from './data-types';
import {
  sqliteInstantMilliseconds,
  storedTextForWrite,
  storedTextFromWire,
  storedTextOfTemporal,
  type TemporalCodecIdentity,
  temporalFromStoredText,
} from './date-time-values';
import { requireTemporal } from './require-temporal';

const DATETIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.Instant',
  stringType: 'DatetimeString',
};
const DATE_TEMPORAL: TemporalCodecIdentity = {
  codecId: SQLITE_DATE_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainDate',
  stringType: 'DateString',
};
const TIME_TEMPORAL: TemporalCodecIdentity = {
  codecId: SQLITE_TIME_TEMPORAL_CODEC_ID,
  temporalTag: 'Temporal.PlainTime',
  stringType: 'TimeString',
};

/** A row's text is what the codec reads, so its JSON is the stored text as it is. */
const storedTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr => expression;

export const sqliteDatetimeTemporalEncode = (value: Temporal.Instant): string =>
  storedTextOfTemporal(DATETIME_TEMPORAL, value, sqliteDatetimeTextAtMilliseconds);

export const sqliteDateTemporalEncode = (value: Temporal.PlainDate): string =>
  storedTextOfTemporal(DATE_TEMPORAL, value, sqliteDateText);

export const sqliteTimeTemporalEncode = (value: Temporal.PlainTime): string =>
  storedTextOfTemporal(TIME_TEMPORAL, value, sqliteTimeText);

/** An instant read as `Temporal.Instant`, from any text or number `sqlite/datetime@1` reads, at millisecond precision. */
export class SqliteDatetimeTemporalCodec extends CodecImpl<
  typeof SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string | number,
  Temporal.Instant
> {
  async toWire(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return sqliteDatetimeTemporalEncode(value);
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    const milliseconds = sqliteInstantMilliseconds(this.id, wire);
    return requireTemporal({ codecId: this.id, operation: 'decode' }).Instant.fromEpochMilliseconds(
      milliseconds,
    );
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.Instant {
    return temporalFromStoredText(DATETIME_TEMPORAL, value.value, (temporal, text) =>
      temporal.Instant.from(text),
    );
  }
  toDataTypeValue(input: Temporal.Instant): DataTypeValue {
    return this.dataTypeValueOf(sqliteDatetimeTemporalEncode(input));
  }
}

export class SqliteDatetimeTemporalDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteDatetime.id;
  override readonly codecId = SQLITE_DATETIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteDatetimeTemporalCodec {
    return () => new SqliteDatetimeTemporalCodec(this, sqliteDatetime);
  }
}

export const sqliteDatetimeTemporalDescriptor = new SqliteDatetimeTemporalDescriptor();

export const sqliteDatetimeTemporalColumn = () =>
  column(
    sqliteDatetimeTemporalDescriptor.factory(),
    sqliteDatetimeTemporalDescriptor.codecId,
    undefined,
  );

sqliteDatetimeTemporalColumn satisfies ColumnHelperFor<SqliteDatetimeTemporalDescriptor>;
sqliteDatetimeTemporalColumn satisfies ColumnHelperForStrict<SqliteDatetimeTemporalDescriptor>;

/** An instant read as the text `sqlite/datetime` stores, `2024-01-01T00:00:00.000Z`, from any text or number `sqlite/datetime@1` reads. A write converts ISO 8601 text with any UTC offset to that form. */
export class SqliteDatetimeStringCodec extends CodecImpl<
  typeof SQLITE_DATETIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string | number,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, sqliteDatetimeTextAtMilliseconds);
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<string> {
    return new Date(sqliteInstantMilliseconds(this.id, wire)).toISOString();
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class SqliteDatetimeStringDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteDatetime.id;
  override readonly codecId = SQLITE_DATETIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteDatetimeStringCodec {
    return () => new SqliteDatetimeStringCodec(this, sqliteDatetime);
  }
}

export const sqliteDatetimeStringDescriptor = new SqliteDatetimeStringDescriptor();

export const sqliteDatetimeStringColumn = () =>
  column(
    sqliteDatetimeStringDescriptor.factory(),
    sqliteDatetimeStringDescriptor.codecId,
    undefined,
  );

sqliteDatetimeStringColumn satisfies ColumnHelperFor<SqliteDatetimeStringDescriptor>;
sqliteDatetimeStringColumn satisfies ColumnHelperForStrict<SqliteDatetimeStringDescriptor>;

/** A calendar date read as the text `sqlite/date` stores, `2024-02-29`. */
export class SqliteDateStringCodec extends CodecImpl<
  typeof SQLITE_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, sqliteDateText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, sqliteDateText);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class SqliteDateStringDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteDate.id;
  override readonly codecId = SQLITE_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteDateStringCodec {
    return () => new SqliteDateStringCodec(this, sqliteDate);
  }
}

export const sqliteDateStringDescriptor = new SqliteDateStringDescriptor();

export const sqliteDateStringColumn = () =>
  column(sqliteDateStringDescriptor.factory(), sqliteDateStringDescriptor.codecId, undefined);

sqliteDateStringColumn satisfies ColumnHelperFor<SqliteDateStringDescriptor>;
sqliteDateStringColumn satisfies ColumnHelperForStrict<SqliteDateStringDescriptor>;

/** A calendar date read as `Temporal.PlainDate`. */
export class SqliteDateTemporalCodec extends CodecImpl<
  typeof SQLITE_DATE_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDate
> {
  async toWire(value: Temporal.PlainDate, _ctx: CodecCallContext): Promise<string> {
    return sqliteDateTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDate> {
    return temporalFromStoredText(
      DATE_TEMPORAL,
      storedTextFromWire(this.id, wire, sqliteDateText),
      (temporal, text) => temporal.PlainDate.from(text),
    );
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainDate {
    return temporalFromStoredText(DATE_TEMPORAL, value.value, (temporal, text) =>
      temporal.PlainDate.from(text),
    );
  }
  toDataTypeValue(input: Temporal.PlainDate): DataTypeValue {
    return this.dataTypeValueOf(sqliteDateTemporalEncode(input));
  }
}

export class SqliteDateTemporalDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteDate.id;
  override readonly codecId = SQLITE_DATE_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteDateTemporalCodec {
    return () => new SqliteDateTemporalCodec(this, sqliteDate);
  }
}

export const sqliteDateTemporalDescriptor = new SqliteDateTemporalDescriptor();

export const sqliteDateTemporalColumn = () =>
  column(sqliteDateTemporalDescriptor.factory(), sqliteDateTemporalDescriptor.codecId, undefined);

sqliteDateTemporalColumn satisfies ColumnHelperFor<SqliteDateTemporalDescriptor>;
sqliteDateTemporalColumn satisfies ColumnHelperForStrict<SqliteDateTemporalDescriptor>;

/** A time of day read as the text `sqlite/time` stores, `09:30:00.000`. A write pads text with fewer fraction digits to three. */
export class SqliteTimeStringCodec extends CodecImpl<
  typeof SQLITE_TIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, sqliteTimeText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, sqliteTimeText);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class SqliteTimeStringDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteTime.id;
  override readonly codecId = SQLITE_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteTimeStringCodec {
    return () => new SqliteTimeStringCodec(this, sqliteTime);
  }
}

export const sqliteTimeStringDescriptor = new SqliteTimeStringDescriptor();

export const sqliteTimeStringColumn = () =>
  column(sqliteTimeStringDescriptor.factory(), sqliteTimeStringDescriptor.codecId, undefined);

sqliteTimeStringColumn satisfies ColumnHelperFor<SqliteTimeStringDescriptor>;
sqliteTimeStringColumn satisfies ColumnHelperForStrict<SqliteTimeStringDescriptor>;

/** A time of day read as `Temporal.PlainTime`. */
export class SqliteTimeTemporalCodec extends CodecImpl<
  typeof SQLITE_TIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainTime
> {
  async toWire(value: Temporal.PlainTime, _ctx: CodecCallContext): Promise<string> {
    return sqliteTimeTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainTime> {
    return temporalFromStoredText(
      TIME_TEMPORAL,
      storedTextFromWire(this.id, wire, sqliteTimeText),
      (temporal, text) => temporal.PlainTime.from(text),
    );
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainTime {
    return temporalFromStoredText(TIME_TEMPORAL, value.value, (temporal, text) =>
      temporal.PlainTime.from(text),
    );
  }
  toDataTypeValue(input: Temporal.PlainTime): DataTypeValue {
    return this.dataTypeValueOf(sqliteTimeTemporalEncode(input));
  }
}

export class SqliteTimeTemporalDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteTime.id;
  override readonly codecId = SQLITE_TIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteTimeTemporalCodec {
    return () => new SqliteTimeTemporalCodec(this, sqliteTime);
  }
}

export const sqliteTimeTemporalDescriptor = new SqliteTimeTemporalDescriptor();

export const sqliteTimeTemporalColumn = () =>
  column(sqliteTimeTemporalDescriptor.factory(), sqliteTimeTemporalDescriptor.codecId, undefined);

sqliteTimeTemporalColumn satisfies ColumnHelperFor<SqliteTimeTemporalDescriptor>;
sqliteTimeTemporalColumn satisfies ColumnHelperForStrict<SqliteTimeTemporalDescriptor>;

/** A length of time read as the ISO 8601 duration it was written as, `PT1H30M`. Its text does not sort in the order of the durations, so it offers no order. */
export class SqliteDurationStringCodec extends CodecImpl<
  typeof SQLITE_DURATION_STRING_CODEC_ID,
  readonly ['equality'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextForWrite(this.id, value, sqliteDurationText);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, wire, sqliteDurationText);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class SqliteDurationStringDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return storedTextJsonProjection(expression);
  }
  override readonly dataType = sqliteDuration.id;
  override readonly codecId = SQLITE_DURATION_STRING_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteDurationStringCodec {
    return () => new SqliteDurationStringCodec(this, sqliteDuration);
  }
}

export const sqliteDurationStringDescriptor = new SqliteDurationStringDescriptor();

export const sqliteDurationStringColumn = () =>
  column(
    sqliteDurationStringDescriptor.factory(),
    sqliteDurationStringDescriptor.codecId,
    undefined,
  );

sqliteDurationStringColumn satisfies ColumnHelperFor<SqliteDurationStringDescriptor>;
sqliteDurationStringColumn satisfies ColumnHelperForStrict<SqliteDurationStringDescriptor>;
