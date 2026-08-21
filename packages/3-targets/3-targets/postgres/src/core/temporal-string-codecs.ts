/**
 * The four temporal codecs whose application value is PostgreSQL's own text.
 *
 * Split out of `codecs.ts`, which the eight representation-explicit temporal codecs had grown past
 * two thousand lines. Their Temporal-valued counterparts live in `temporal-codecs.ts`, and the
 * substrate both halves share lives in `temporal-codec-helpers.ts`.
 */

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
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
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
  serverTextJsonProjection,
} from './temporal-codec-helpers';

/**
 * Representation-explicit temporal codecs whose application value is PostgreSQL's own text.
 *
 * Every direction is identity: a value is bound exactly as the application supplied it, and the
 * server's rendering is returned exactly as it arrived. PostgreSQL alone decides which inputs are
 * valid and how an accepted value is normalised, so these codecs neither validate, normalise, nor
 * canonicalise. That is what makes them the lossless escape hatch for values with no counterpart in
 * a richer temporal representation — `infinity`, BC and expanded-year dates, microsecond precision —
 * and what makes session settings such as `DateStyle` and `TimeZone` observable rather than hidden.
 *
 * `targetTypes` is empty on all four: introspection ownership of `date` / `timestamp` /
 * `timestamptz` / `time` belongs to the codecs that carry the richer representation, and these are
 * selected explicitly by the schema author instead.
 */
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

/**
 * Alone among the four, this descriptor carries no `renderOutputType`, so a `date` column reads as
 * plain `string` rather than a branded `DateString`. Two reasons, both structural: the emitter only
 * consults `renderOutputType` for a column with non-empty type params, and a `date` has no
 * precision to carry — so a renderer here would never be called. Branding the codec's own type
 * instead would reach the declaration, but it would also make the *write* side branded, and a
 * plain string literal is no longer assignable to it. The asymmetry is the honest shape; please
 * don't tidy it away.
 */
export class PgDateStringDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
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
    return serverTextJsonProjection(expression);
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
    return serverTextJsonProjection(expression);
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
    return serverTextJsonProjection(expression);
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
