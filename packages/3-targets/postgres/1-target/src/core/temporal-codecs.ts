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
import type { Temporal } from 'temporal-spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import type { PrecisionParams } from './codec-helpers';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_INSTANT_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { pgDate, pgPrecisionParams, pgTime, pgTimestamp, pgTimestamptz } from './data-types';
import {
  pgDateTemporalDecode,
  pgDateTemporalEncode,
  pgTimestampInstantDecode,
  pgTimestampInstantEncode,
  pgTimestampTemporalDecode,
  pgTimestampTemporalEncode,
  pgTimestamptzTemporalDecode,
  pgTimestamptzTemporalEncode,
  pgTimeTemporalDecode,
  pgTimeTemporalEncode,
  refuseInfinity,
} from './temporal-codec-helpers';

export class PgDateTemporalCodec extends CodecImpl<
  typeof PG_DATE_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDate
> {
  async toWire(value: Temporal.PlainDate, _ctx: CodecCallContext): Promise<string> {
    return pgDateTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDate> {
    return pgDateTemporalDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainDate {
    refuseInfinity(
      this.id,
      'a date a Temporal.PlainDate holds',
      PG_DATE_STRING_CODEC_ID,
      value.value,
    );
    return pgDateTemporalDecode(value.value);
  }
  toDataTypeValue(input: Temporal.PlainDate): DataTypeValue {
    return this.dataTypeValueOf(pgDateTemporalEncode(input));
  }
}

export class PgDateTemporalDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgDate.id;
  override readonly codecId = PG_DATE_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgDateTemporalCodec {
    return () => new PgDateTemporalCodec(this, pgDate);
  }
}

export const pgDateTemporalDescriptor = new PgDateTemporalDescriptor();

export const pgDateTemporalColumn = () =>
  column(pgDateTemporalDescriptor.factory(), pgDateTemporalDescriptor.codecId, undefined);

pgDateTemporalColumn satisfies ColumnHelperFor<PgDateTemporalDescriptor>;
pgDateTemporalColumn satisfies ColumnHelperForStrict<PgDateTemporalDescriptor>;

export class PgTimestampTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDateTime
> {
  async toWire(value: Temporal.PlainDateTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimestampTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDateTime> {
    return pgTimestampTemporalDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainDateTime {
    refuseInfinity(
      this.id,
      'a date and time a Temporal.PlainDateTime holds',
      PG_TIMESTAMP_STRING_CODEC_ID,
      value.value,
    );
    return pgTimestampTemporalDecode(value.value);
  }
  toDataTypeValue(input: Temporal.PlainDateTime): DataTypeValue {
    return this.dataTypeValueOf(pgTimestampTemporalEncode(input));
  }
}

export class PgTimestampTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamp.id;
  override readonly codecId = PG_TIMESTAMP_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampTemporalCodec {
    return () => new PgTimestampTemporalCodec(this, pgTimestamp, params ?? {});
  }
}

export const pgTimestampTemporalDescriptor = new PgTimestampTemporalDescriptor();

export const pgTimestampTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampTemporalDescriptor.factory(params),
    pgTimestampTemporalDescriptor.codecId,
    params,
  );

pgTimestampTemporalColumn satisfies ColumnHelperFor<PgTimestampTemporalDescriptor>;
pgTimestampTemporalColumn satisfies ColumnHelperForStrict<PgTimestampTemporalDescriptor>;

/**
 * A `timestamp` column read and written as a `Temporal.Instant`, treating the stored date and time as UTC. A write sends the instant's UTC date and time with no offset. PostgreSQL fills a database default `now()` in the session's time zone, so under a `TimeZone` other than UTC that value reads back shifted; `@onCreate(now())` writes UTC from the client.
 */
export class PgTimestampInstantCodec extends CodecImpl<
  typeof PG_TIMESTAMP_INSTANT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async toWire(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return pgTimestampInstantEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return pgTimestampInstantDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.Instant {
    refuseInfinity(
      this.id,
      'an instant a Temporal.Instant holds',
      PG_TIMESTAMP_STRING_CODEC_ID,
      value.value,
    );
    return pgTimestampInstantDecode(value.value);
  }
  toDataTypeValue(input: Temporal.Instant): DataTypeValue {
    return this.dataTypeValueOf(pgTimestampInstantEncode(input));
  }
}

export class PgTimestampInstantDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamp.id;
  override readonly codecId = PG_TIMESTAMP_INSTANT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampInstantCodec {
    return () => new PgTimestampInstantCodec(this, pgTimestamp, params ?? {});
  }
}

export const pgTimestampInstantDescriptor = new PgTimestampInstantDescriptor();

export const pgTimestampInstantColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampInstantDescriptor.factory(params),
    pgTimestampInstantDescriptor.codecId,
    params,
  );

pgTimestampInstantColumn satisfies ColumnHelperFor<PgTimestampInstantDescriptor>;
pgTimestampInstantColumn satisfies ColumnHelperForStrict<PgTimestampInstantDescriptor>;

export class PgTimestamptzTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async toWire(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return pgTimestamptzTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return pgTimestamptzTemporalDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.Instant {
    refuseInfinity(
      this.id,
      'an instant a Temporal.Instant holds',
      PG_TIMESTAMPTZ_STRING_CODEC_ID,
      value.value,
    );
    return pgTimestamptzTemporalDecode(value.value);
  }
  toDataTypeValue(input: Temporal.Instant): DataTypeValue {
    return this.dataTypeValueOf(pgTimestamptzTemporalEncode(input));
  }
}

export class PgTimestamptzTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamptz.id;
  override readonly codecId = PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzTemporalCodec {
    return () => new PgTimestamptzTemporalCodec(this, pgTimestamptz, params ?? {});
  }
}

export const pgTimestamptzTemporalDescriptor = new PgTimestamptzTemporalDescriptor();

export const pgTimestamptzTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzTemporalDescriptor.factory(params),
    pgTimestamptzTemporalDescriptor.codecId,
    params,
  );

pgTimestamptzTemporalColumn satisfies ColumnHelperFor<PgTimestamptzTemporalDescriptor>;
pgTimestamptzTemporalColumn satisfies ColumnHelperForStrict<PgTimestamptzTemporalDescriptor>;

export class PgTimeTemporalCodec extends CodecImpl<
  typeof PG_TIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainTime
> {
  async toWire(value: Temporal.PlainTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimeTemporalEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainTime> {
    return pgTimeTemporalDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Temporal.PlainTime {
    return pgTimeTemporalDecode(value.value);
  }
  toDataTypeValue(input: Temporal.PlainTime): DataTypeValue {
    return this.dataTypeValueOf(pgTimeTemporalEncode(input));
  }
}

export class PgTimeTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTime.id;
  override readonly codecId = PG_TIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeTemporalCodec {
    return () => new PgTimeTemporalCodec(this, pgTime, params ?? {});
  }
}

export const pgTimeTemporalDescriptor = new PgTimeTemporalDescriptor();

export const pgTimeTemporalColumn = (params: PrecisionParams = {}) =>
  column(pgTimeTemporalDescriptor.factory(params), pgTimeTemporalDescriptor.codecId, params);

pgTimeTemporalColumn satisfies ColumnHelperFor<PgTimeTemporalDescriptor>;
pgTimeTemporalColumn satisfies ColumnHelperForStrict<PgTimeTemporalDescriptor>;
