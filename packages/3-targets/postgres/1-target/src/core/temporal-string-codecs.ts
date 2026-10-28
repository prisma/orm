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
import { CastExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import type { PrecisionParams } from './codec-helpers';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from './codec-ids';
import { pgDate, pgPrecisionParams, pgTime, pgTimestamp, pgTimestamptz } from './data-types';
import { type DateTimeWireReading, storedTextFromWire } from './date-time-wire-text';
import { errorTimestampTextWrongType } from './errors';
import { postgresYearText } from './postgres-year-text';

const DATE_READING: DateTimeWireReading = { shape: 'date', holdsInfinity: true };
const TIMESTAMP_READING: DateTimeWireReading = { shape: 'dateTime', holdsInfinity: true };
const TIMESTAMPTZ_READING: DateTimeWireReading = { shape: 'instant', holdsInfinity: true };
const TIME_READING: DateTimeWireReading = { shape: 'time', holdsInfinity: false };

export class PgDateStringCodec extends CodecImpl<
  typeof PG_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return postgresYearText(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, DATE_READING, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class PgDateStringDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgDate.id;
  override readonly codecId = PG_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgDateStringCodec {
    return () => new PgDateStringCodec(this, pgDate);
  }
}

export const pgDateStringDescriptor = new PgDateStringDescriptor();

export const pgDateStringColumn = () =>
  column(pgDateStringDescriptor.factory(), pgDateStringDescriptor.codecId, undefined);

pgDateStringColumn satisfies ColumnHelperFor<PgDateStringDescriptor>;
pgDateStringColumn satisfies ColumnHelperForStrict<PgDateStringDescriptor>;

function requireText(codecId: string, value: unknown): string {
  if (typeof value === 'string') return value;
  throw errorTimestampTextWrongType(codecId, describeValue(value));
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'a Date';
  return `a ${typeof value}`;
}

export class PgTimestampStringCodec extends CodecImpl<
  typeof PG_TIMESTAMP_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return postgresYearText(requireText(this.id, value));
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, TIMESTAMP_READING, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class PgTimestampStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamp.id;
  override readonly codecId = PG_TIMESTAMP_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestampStringCodec {
    return () => new PgTimestampStringCodec(this, pgTimestamp, params ?? {});
  }
}

export const pgTimestampStringDescriptor = new PgTimestampStringDescriptor();

export const pgTimestampStringColumn = (params: PrecisionParams = {}) =>
  column(pgTimestampStringDescriptor.factory(params), pgTimestampStringDescriptor.codecId, params);

pgTimestampStringColumn satisfies ColumnHelperFor<PgTimestampStringDescriptor>;
pgTimestampStringColumn satisfies ColumnHelperForStrict<PgTimestampStringDescriptor>;

export class PgTimestamptzStringCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return postgresYearText(requireText(this.id, value));
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, TIMESTAMPTZ_READING, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class PgTimestamptzStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamptz.id;
  override readonly codecId = PG_TIMESTAMPTZ_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzStringCodec {
    return () => new PgTimestamptzStringCodec(this, pgTimestamptz, params ?? {});
  }
}

export const pgTimestamptzStringDescriptor = new PgTimestamptzStringDescriptor();

export const pgTimestamptzStringColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzStringDescriptor.factory(params),
    pgTimestamptzStringDescriptor.codecId,
    params,
  );

pgTimestamptzStringColumn satisfies ColumnHelperFor<PgTimestamptzStringDescriptor>;
pgTimestamptzStringColumn satisfies ColumnHelperForStrict<PgTimestamptzStringDescriptor>;

export class PgTimeStringCodec extends CodecImpl<
  typeof PG_TIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, TIME_READING, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class PgTimeStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTime.id;
  override readonly codecId = PG_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeStringCodec {
    return () => new PgTimeStringCodec(this, pgTime, params ?? {});
  }
}

export const pgTimeStringDescriptor = new PgTimeStringDescriptor();

export const pgTimeStringColumn = (params: PrecisionParams = {}) =>
  column(pgTimeStringDescriptor.factory(params), pgTimeStringDescriptor.codecId, params);

pgTimeStringColumn satisfies ColumnHelperFor<PgTimeStringDescriptor>;
pgTimeStringColumn satisfies ColumnHelperForStrict<PgTimeStringDescriptor>;
