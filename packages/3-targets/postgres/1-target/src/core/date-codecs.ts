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
import {
  PG_TIMESTAMP_DATE_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from './codec-ids';
import {
  pgPrecisionParams,
  pgTimestamp,
  pgTimestampStoredText,
  pgTimestamptz,
  pgTimestamptzStoredText,
} from './data-types';
import { requireIsoDateStyle } from './date-time-wire-text';
import {
  EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS,
  utcTimestampText,
  utcTimestamptzText,
} from './temporal-codec-helpers';

/** What a `Date` codec reads, and the text type that holds what a `Date` cannot. */
interface DateCodecIdentity {
  readonly codecId: string;
  readonly typeDescription: string;
  readonly stringType: string;
  readonly textCodecId: string;
  /** The instant, in the stored spelling of `pg/timestamptz`, that text of the codec's data type names. */
  readonly instantText: (text: string) => string;
}

const TIMESTAMPTZ_DATE: DateCodecIdentity = {
  codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
  typeDescription: 'timestamp with time zone',
  stringType: 'TimestamptzString',
  textCodecId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
  instantText: pgTimestamptzStoredText,
};

const TIMESTAMP_DATE: DateCodecIdentity = {
  codecId: PG_TIMESTAMP_DATE_CODEC_ID,
  typeDescription: 'timestamp, read as UTC',
  stringType: 'TimestampString',
  textCodecId: PG_TIMESTAMP_STRING_CODEC_ID,
  instantText: (text) => pgTimestamptzStoredText(`${pgTimestampStoredText(text)}Z`),
};

function invalidDate(identity: DateCodecIdentity): RangeError {
  return new RangeError(
    `${identity.codecId} requires a valid Date or a representable ISO PostgreSQL ${identity.typeDescription}; use ${identity.stringType} for unsupported values`,
  );
}

function isRepresentable(value: Date): boolean {
  return (
    value instanceof Date &&
    Number.isFinite(value.getTime()) &&
    value.getTime() >= EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS
  );
}

function validateDate(identity: DateCodecIdentity, value: Date): Date {
  if (!isRepresentable(value)) throw invalidDate(identity);
  return value;
}

/** The instant a stored or printed value names, or `undefined` for `infinity` and a value outside the range a `Date` holds. */
function storedInstant(identity: DateCodecIdentity, text: string): string | undefined {
  if (text === 'infinity' || text === '-infinity') return undefined;
  try {
    return identity.instantText(text);
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') return undefined;
    throw error;
  }
}

function decodeDate(identity: DateCodecIdentity, wire: unknown): Date {
  const instant =
    typeof wire === 'string'
      ? storedInstant(identity, requireIsoDateStyle(identity.codecId, wire))
      : undefined;
  const date = instant === undefined ? undefined : new Date(instant);
  if (date === undefined || !isRepresentable(date)) throw invalidDate(identity);
  return date;
}

/** The `Date` a stored value names. A `Date` holds neither `infinity` nor an instant before 4714-11-24 BC or after +275760-09-13, so those are refused. */
function dateOfStoredText(identity: DateCodecIdentity, text: string): Date {
  const instant = storedInstant(identity, text);
  const date = instant === undefined ? undefined : new Date(instant);
  if (date === undefined || !isRepresentable(date)) {
    return refuseJsonValue(
      identity.codecId,
      `an instant a Date holds, from 4714-11-24 BC to +275760-09-13 and not infinity or -infinity, which ${identity.textCodecId} holds`,
      text,
    );
  }
  return date;
}

export class PgTimestamptzDateCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async toWire(value: Date, _ctx: CodecCallContext): Promise<string> {
    return utcTimestamptzText(validateDate(TIMESTAMPTZ_DATE, value), this.id);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return decodeDate(TIMESTAMPTZ_DATE, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Date {
    return dateOfStoredText(TIMESTAMPTZ_DATE, value.value);
  }
  toDataTypeValue(input: Date): DataTypeValue {
    return this.dataTypeValueOf(validateDate(TIMESTAMPTZ_DATE, input).toISOString());
  }
}

export class PgTimestamptzDateDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
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

/**
 * A `timestamp` column read and written as a JavaScript `Date`, treating the stored date and time as UTC. A read appends `Z` to the stored value; a write sends the `Date`'s UTC date and time with no offset, so a written value reads back unchanged whatever the server's, the session's or the process's time zone. PostgreSQL fills a database default `now()` in the session's time zone, so under a `TimeZone` other than UTC that value reads back shifted; `@onCreate(now())` writes UTC from the client.
 */
export class PgTimestampDateCodec extends CodecImpl<
  typeof PG_TIMESTAMP_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async toWire(value: Date, _ctx: CodecCallContext): Promise<string> {
    return utcTimestampText(validateDate(TIMESTAMP_DATE, value), this.id);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return decodeDate(TIMESTAMP_DATE, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Date {
    return dateOfStoredText(TIMESTAMP_DATE, value.value);
  }
  toDataTypeValue(input: Date): DataTypeValue {
    return this.dataTypeValueOf(utcTimestampText(validateDate(TIMESTAMP_DATE, input), this.id));
  }
}

export class PgTimestampDateDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamp.id;
  override readonly codecId = PG_TIMESTAMP_DATE_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestampDateCodec {
    return () => new PgTimestampDateCodec(this, pgTimestamp, params ?? {});
  }
}

export const pgTimestampDateDescriptor = new PgTimestampDateDescriptor();

export const pgTimestampDateColumn = (params: PrecisionParams = {}) =>
  column(pgTimestampDateDescriptor.factory(params), pgTimestampDateDescriptor.codecId, params);

pgTimestampDateColumn satisfies ColumnHelperFor<PgTimestampDateDescriptor>;
pgTimestampDateColumn satisfies ColumnHelperForStrict<PgTimestampDateDescriptor>;
