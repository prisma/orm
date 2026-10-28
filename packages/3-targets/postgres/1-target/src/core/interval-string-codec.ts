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
import { type PrecisionParams, pgIntervalDecode } from './codec-helpers';
import { PG_INTERVAL_STRING_CODEC_ID } from './codec-ids';
import { formatIsoDuration, ISO_DURATION, pgIntervalStoredText } from './data-type-values';
import { pgInterval, pgPrecisionParams } from './data-types';
import { postgresError } from './errors';

const MAX_FRACTION_DIGITS = 6;

function describeReceived(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return value === null ? 'null' : `a ${typeof value}`;
}

function refusedDuration(value: unknown, reason: string): never {
  throw postgresError(
    'RUNTIME.ENCODE_FAILED',
    `${PG_INTERVAL_STRING_CODEC_ID} writes ${reason}, got ${describeReceived(value)}`,
    { meta: { codecId: PG_INTERVAL_STRING_CODEC_ID, received: typeof value } },
  );
}

/** The duration `pg/interval` stores for an ISO 8601 duration the application wrote. */
function storedDuration(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DURATION.test(value)) {
    return refusedDuration(value, 'an ISO 8601 duration, as in "P1Y2M3DT4H5M6.5S"');
  }
  const fractionDigits = /\.(\d+)S$/.exec(value)?.[1]?.length ?? 0;
  if (fractionDigits > MAX_FRACTION_DIGITS) {
    return refusedDuration(
      value,
      `a duration with at most ${MAX_FRACTION_DIGITS} digits after the decimal point, because pg/interval holds microseconds`,
    );
  }
  return pgIntervalStoredText(value);
}

/**
 * An interval read and written as the ISO 8601 duration `pg/interval` stores, such as `P1Y2M3DT4H5M6.5S`. A read gives that form whatever `IntervalStyle` the server prints in. Equal intervals can have different forms, `P1D` and `PT24H`, so the codec keeps the form a value was written in.
 */
export class PgIntervalStringCodec extends CodecImpl<
  typeof PG_INTERVAL_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string | Record<string, unknown>,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return storedDuration(value);
  }
  async fromWire(wire: string | Record<string, unknown>, _ctx: CodecCallContext): Promise<string> {
    return formatIsoDuration(pgIntervalDecode(wire));
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(storedDuration(input));
  }
}

export class PgIntervalStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgInterval.id;
  override readonly codecId = PG_INTERVAL_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly keepsWrittenForm = true as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgIntervalStringCodec {
    return () => new PgIntervalStringCodec(this, pgInterval, params ?? {});
  }
}

export const pgIntervalStringDescriptor = new PgIntervalStringDescriptor();

export const pgIntervalStringColumn = (params: PrecisionParams = {}) =>
  column(pgIntervalStringDescriptor.factory(params), pgIntervalStringDescriptor.codecId, params);

pgIntervalStringColumn satisfies ColumnHelperFor<PgIntervalStringDescriptor>;
pgIntervalStringColumn satisfies ColumnHelperForStrict<PgIntervalStringDescriptor>;
