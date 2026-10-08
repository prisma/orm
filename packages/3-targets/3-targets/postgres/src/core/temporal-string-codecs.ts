import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import { CastExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import { type PrecisionParams, renderPrecision } from './codec-helpers';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from './codec-ids';
import {
  pgDate,
  pgDateCanonical,
  pgPrecisionParams,
  pgTime,
  pgTimeCanonical,
  pgTimestamp,
  pgTimestampCanonical,
  pgTimestamptz,
  pgTimestamptzCanonical,
} from './data-types';
import { utcTimestampText, utcTimestamptzText } from './temporal-codec-helpers';

export class PgDateStringCodec extends CodecImpl<
  typeof PG_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(pgDateCanonical(input));
  }
}

export class PgDateStringDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgDate.id;
  override readonly codecId = PG_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgDateStringCodec {
    return () => new PgDateStringCodec(this, pgDate);
  }
}

export const pgDateStringDescriptor = new PgDateStringDescriptor();

export const pgDateStringColumn = () =>
  column(pgDateStringDescriptor.factory(), pgDateStringDescriptor.codecId, undefined);

pgDateStringColumn satisfies ColumnHelperFor<PgDateStringDescriptor>;
pgDateStringColumn satisfies ColumnHelperForStrict<PgDateStringDescriptor>;

export class PgTimestampStringCodec extends CodecImpl<
  typeof PG_TIMESTAMP_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  // `CodecTypes` reads the application type from the last signature, so `string` stays last.
  toWire(value: Date, ctx: CodecCallContext): Promise<string>;
  toWire(value: string, ctx: CodecCallContext): Promise<string>;
  async toWire(value: string | Date, _ctx: CodecCallContext): Promise<string> {
    return value instanceof Date ? utcTimestampText(value, this.id) : value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(pgTimestampCanonical(input));
  }
}

/** Why an enum cannot use a string timestamp codec, given how PostgreSQL prints a value and how the contract stores it. */
const stringTimestampEnumRefusal = (
  printed: string,
  stored: string,
  printing: string,
  instead: string,
): string =>
  `A query reads each value as the text PostgreSQL prints${printing}, such as "${printed}", while the contract stores it in ISO 8601, such as "${stored}", so no value read back equals a member. Use ${instead}, whose members are Temporal values.`;

export class PgTimestampStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamp.id;
  override readonly codecId = PG_TIMESTAMP_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly enumRefusal = stringTimestampEnumRefusal(
    '2024-01-02 03:04:05',
    '2024-01-02T03:04:05',
    '',
    'pg/timestamp-temporal@1',
  );
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestampString', params);
  }
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
  // `CodecTypes` reads the application type from the last signature, so `string` stays last.
  toWire(value: Date, ctx: CodecCallContext): Promise<string>;
  toWire(value: string, ctx: CodecCallContext): Promise<string>;
  async toWire(value: string | Date, _ctx: CodecCallContext): Promise<string> {
    return value instanceof Date ? utcTimestamptzText(value, this.id) : value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(pgTimestamptzCanonical(input));
  }
}

export class PgTimestamptzStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamptz.id;
  override readonly codecId = PG_TIMESTAMPTZ_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly enumRefusal = stringTimestampEnumRefusal(
    '2024-01-02 03:04:05+00',
    '2024-01-02T03:04:05Z',
    " in the session's time zone",
    'pg/timestamptz-temporal@1',
  );
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestamptzString', params);
  }
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
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(pgTimeCanonical(input));
  }
}

export class PgTimeStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTime.id;
  override readonly codecId = PG_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimeString', params);
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
