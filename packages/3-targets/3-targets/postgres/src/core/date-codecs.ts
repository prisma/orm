import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { CastExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import { isStructuredError } from '@internal/utils/structured-error';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import type { PrecisionParams } from './codec-helpers';
import { PG_TIMESTAMPTZ_DATE_CODEC_ID, PG_TIMESTAMPTZ_STRING_CODEC_ID } from './codec-ids';
import { pgPrecisionParams, pgTimestamptz, pgTimestamptzStoredText } from './data-types';
import {
  EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS,
  utcTimestamptzText,
} from './temporal-codec-helpers';

function invalidDate(): RangeError {
  return new RangeError(
    `${PG_TIMESTAMPTZ_DATE_CODEC_ID} requires a valid Date or a representable ISO PostgreSQL timestamp with time zone; use TimestamptzString for unsupported values`,
  );
}

function isRepresentable(value: Date): boolean {
  return (
    value instanceof Date &&
    Number.isFinite(value.getTime()) &&
    value.getTime() >= EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS
  );
}

function validateDate(value: Date): Date {
  if (!isRepresentable(value)) throw invalidDate();
  return value;
}

function decodeDate(wire: unknown): Date {
  const instant = typeof wire === 'string' ? storedInstant(wire) : undefined;
  const date = instant === undefined ? undefined : new Date(instant);
  if (date === undefined || !isRepresentable(date)) throw invalidDate();
  return date;
}

/** The instant, in its stored spelling, a stored timestamp with time zone names, or `undefined` for `infinity` and an instant outside the range a `Date` holds. */
function storedInstant(text: string): string | undefined {
  if (text === 'infinity' || text === '-infinity') return undefined;
  try {
    return pgTimestamptzStoredText(text);
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') return undefined;
    throw error;
  }
}

/** The `Date` a stored timestamp with time zone names. A `Date` holds neither `infinity` nor an instant before 4714-11-24 BC or after +275760-09-13, so those are refused. */
function dateOfStoredText(codecId: string, text: string): Date {
  const instant = storedInstant(text);
  const date = instant === undefined ? undefined : new Date(instant);
  if (date === undefined || !isRepresentable(date)) {
    return refuseJsonValue(
      codecId,
      `an instant a Date holds, from 4714-11-24 BC to +275760-09-13 and not infinity or -infinity, which ${PG_TIMESTAMPTZ_STRING_CODEC_ID} holds`,
      text,
    );
  }
  return date;
}

function encodeDate(value: Date): string {
  return utcTimestamptzText(validateDate(value), PG_TIMESTAMPTZ_DATE_CODEC_ID);
}

export class PgTimestamptzDateCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async toWire(value: Date, _ctx: CodecCallContext): Promise<string> {
    return encodeDate(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return decodeDate(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Date {
    return dateOfStoredText(this.id, value.value);
  }
  toDataTypeValue(input: Date): DataTypeValue {
    return this.dataTypeValueOf(validateDate(input).toISOString());
  }
}

export class PgTimestamptzDateDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamptz.id;
  override readonly codecId = PG_TIMESTAMPTZ_DATE_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestamptzDateCodec {
    return () => new PgTimestamptzDateCodec(this, pgTimestamptz, params ?? {});
  }
}

export const pgTimestamptzDateDescriptor = new PgTimestamptzDateDescriptor();

export const pgTimestamptzDateColumn = (params: PrecisionParams = {}) =>
  column(pgTimestamptzDateDescriptor.factory(params), pgTimestamptzDateDescriptor.codecId, params);

pgTimestamptzDateColumn satisfies ColumnHelperFor<PgTimestamptzDateDescriptor>;
pgTimestamptzDateColumn satisfies ColumnHelperForStrict<PgTimestamptzDateDescriptor>;
