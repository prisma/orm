import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import { CastExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import { type PrecisionParams, precisionParamsSchema, renderPrecision } from './codec-helpers';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from './codec-ids';
import {
  PG_DATE_NATIVE_TYPE,
  PG_TIME_NATIVE_TYPE,
  PG_TIMESTAMP_NATIVE_TYPE,
  PG_TIMESTAMPTZ_NATIVE_TYPE,
} from './temporal-codec-helpers';

export class PgDateStringCodec extends CodecImpl<
  typeof PG_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'date-string columns serialize to JSON as their wire string form'>(
      json,
    );
  }
}

export class PgDateStringDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly codecId = PG_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgDateStringCodec {
    return () => new PgDateStringCodec(this);
  }
}

export const pgDateStringDescriptor = new PgDateStringDescriptor();

export const pgDateStringColumn = () =>
  column(pgDateStringDescriptor.factory(), pgDateStringDescriptor.codecId, undefined, 'date');

pgDateStringColumn satisfies ColumnHelperFor<PgDateStringDescriptor>;
pgDateStringColumn satisfies ColumnHelperForStrict<PgDateStringDescriptor>;

export class PgTimestampStringCodec extends CodecImpl<
  typeof PG_TIMESTAMP_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<
      string,
      'timestamp-string columns serialize to JSON as their wire string form'
    >(json);
  }
}

export class PgTimestampStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMP_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly codecId = PG_TIMESTAMP_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestampString', params);
  }
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampStringCodec {
    return () => new PgTimestampStringCodec(this);
  }
}

export const pgTimestampStringDescriptor = new PgTimestampStringDescriptor();

export const pgTimestampStringColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampStringDescriptor.factory(params),
    pgTimestampStringDescriptor.codecId,
    params,
    'timestamp',
  );

pgTimestampStringColumn satisfies ColumnHelperFor<PgTimestampStringDescriptor>;
pgTimestampStringColumn satisfies ColumnHelperForStrict<PgTimestampStringDescriptor>;

export class PgTimestamptzStringCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<
      string,
      'timestamptz-string columns serialize to JSON as their wire string form'
    >(json);
  }
}

export class PgTimestamptzStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly codecId = PG_TIMESTAMPTZ_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestamptzString', params);
  }
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzStringCodec {
    return () => new PgTimestamptzStringCodec(this);
  }
}

export const pgTimestamptzStringDescriptor = new PgTimestamptzStringDescriptor();

export const pgTimestamptzStringColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzStringDescriptor.factory(params),
    pgTimestamptzStringDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzStringColumn satisfies ColumnHelperFor<PgTimestamptzStringDescriptor>;
pgTimestamptzStringColumn satisfies ColumnHelperForStrict<PgTimestamptzStringDescriptor>;

export class PgTimeStringCodec extends CodecImpl<
  typeof PG_TIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'time-string columns serialize to JSON as their wire string form'>(
      json,
    );
  }
}

export class PgTimeStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIME_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly codecId = PG_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimeString', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeStringCodec {
    return () => new PgTimeStringCodec(this);
  }
}

export const pgTimeStringDescriptor = new PgTimeStringDescriptor();

export const pgTimeStringColumn = (params: PrecisionParams = {}) =>
  column(pgTimeStringDescriptor.factory(params), pgTimeStringDescriptor.codecId, params, 'time');

pgTimeStringColumn satisfies ColumnHelperFor<PgTimeStringDescriptor>;
pgTimeStringColumn satisfies ColumnHelperForStrict<PgTimeStringDescriptor>;
