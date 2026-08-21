/**
 * The four temporal codecs whose application value is a `Temporal.*`.
 *
 * Split out of `codecs.ts`, which the eight representation-explicit temporal codecs had grown past
 * two thousand lines. Their text-valued counterparts live in `temporal-string-codecs.ts`, and the
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
import { type PrecisionParams, precisionParamsSchema } from './codec-helpers';
import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import {
  PG_DATE_NATIVE_TYPE,
  PG_TIME_NATIVE_TYPE,
  PG_TIMESTAMP_NATIVE_TYPE,
  PG_TIMESTAMPTZ_NATIVE_TYPE,
  pgDateTemporalDecode,
  pgDateTemporalEncode,
  pgTimestampTemporalDecode,
  pgTimestampTemporalEncode,
  pgTimestamptzTemporalDecode,
  pgTimestamptzTemporalEncode,
  pgTimeTemporalDecode,
  pgTimeTemporalEncode,
  serverTextJsonProjection,
} from './temporal-codec-helpers';

/**
 * Temporal-backed temporal codecs: the application value is the `Temporal.*` type that matches the
 * column's native type, and the wire value is PostgreSQL's own text in both directions.
 *
 * `Temporal.*.from()` is the authoritative parser and the authoritative range check — these codecs
 * add only PostgreSQL's `infinity` sentinels and the named era adaptation for BC and expanded
 * years. Anything Temporal declines is reported as unrepresentable, naming the `*String` type that
 * reads the same column losslessly.
 *
 * The application type reaches the generated declaration through `TInput` rather than
 * `renderOutputType`: the emitter only consults a renderer for a column carrying non-empty type
 * params, so a bare `Timestamp` would fall through it. `Temporal` is referenced as an ambient
 * global and no polyfill type is imported, which is why these carry no `typeImports` entry.
 */
export class PgDateTemporalCodec extends CodecImpl<
  typeof PG_DATE_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDate
> {
  async encode(value: Temporal.PlainDate, _ctx: CodecCallContext): Promise<string> {
    return pgDateTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDate> {
    return pgDateTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainDate): JsonValue {
    return pgDateTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainDate {
    return pgDateTemporalDecode(
      blindCast<string, 'date-temporal columns serialize to JSON as their wire string form'>(json),
    );
  }
}

export class PgDateTemporalDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_DATE_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['date'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgDateTemporalCodec {
    return () => new PgDateTemporalCodec(this);
  }
}

export const pgDateTemporalDescriptor = new PgDateTemporalDescriptor();

export const pgDateTemporalColumn = () =>
  column(pgDateTemporalDescriptor.factory(), pgDateTemporalDescriptor.codecId, undefined, 'date');

pgDateTemporalColumn satisfies ColumnHelperFor<PgDateTemporalDescriptor>;
pgDateTemporalColumn satisfies ColumnHelperForStrict<PgDateTemporalDescriptor>;

export class PgTimestampTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDateTime
> {
  async encode(value: Temporal.PlainDateTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimestampTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDateTime> {
    return pgTimestampTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainDateTime): JsonValue {
    return pgTimestampTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainDateTime {
    return pgTimestampTemporalDecode(
      blindCast<string, 'timestamp-temporal columns serialize to JSON as their wire string form'>(
        json,
      ),
    );
  }
}

export class PgTimestampTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMP_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMP_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamp'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampTemporalCodec {
    return () => new PgTimestampTemporalCodec(this);
  }
}

export const pgTimestampTemporalDescriptor = new PgTimestampTemporalDescriptor();

export const pgTimestampTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampTemporalDescriptor.factory(params),
    pgTimestampTemporalDescriptor.codecId,
    params,
    'timestamp',
  );

pgTimestampTemporalColumn satisfies ColumnHelperFor<PgTimestampTemporalDescriptor>;
pgTimestampTemporalColumn satisfies ColumnHelperForStrict<PgTimestampTemporalDescriptor>;

export class PgTimestamptzTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async encode(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return pgTimestamptzTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return pgTimestamptzTemporalDecode(wire);
  }
  encodeJson(value: Temporal.Instant): JsonValue {
    return pgTimestamptzTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.Instant {
    return pgTimestamptzTemporalDecode(
      blindCast<string, 'timestamptz-temporal columns serialize to JSON as their wire string form'>(
        json,
      ),
    );
  }
}

export class PgTimestamptzTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamptz'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzTemporalCodec {
    return () => new PgTimestamptzTemporalCodec(this);
  }
}

export const pgTimestamptzTemporalDescriptor = new PgTimestamptzTemporalDescriptor();

export const pgTimestamptzTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzTemporalDescriptor.factory(params),
    pgTimestamptzTemporalDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzTemporalColumn satisfies ColumnHelperFor<PgTimestamptzTemporalDescriptor>;
pgTimestamptzTemporalColumn satisfies ColumnHelperForStrict<PgTimestamptzTemporalDescriptor>;

export class PgTimeTemporalCodec extends CodecImpl<
  typeof PG_TIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainTime
> {
  async encode(value: Temporal.PlainTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimeTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainTime> {
    return pgTimeTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainTime): JsonValue {
    return pgTimeTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainTime {
    return pgTimeTemporalDecode(
      blindCast<string, 'time-temporal columns serialize to JSON as their wire string form'>(json),
    );
  }
}

export class PgTimeTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIME_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['time'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeTemporalCodec {
    return () => new PgTimeTemporalCodec(this);
  }
}

export const pgTimeTemporalDescriptor = new PgTimeTemporalDescriptor();

export const pgTimeTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimeTemporalDescriptor.factory(params),
    pgTimeTemporalDescriptor.codecId,
    params,
    'time',
  );

pgTimeTemporalColumn satisfies ColumnHelperFor<PgTimeTemporalDescriptor>;
pgTimeTemporalColumn satisfies ColumnHelperForStrict<PgTimeTemporalDescriptor>;
