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
import { PG_TIMESTAMPTZ_DATE_CODEC_ID } from './codec-ids';
import { pgPrecisionParams, pgTimestamptz, pgTimestamptzCanonical } from './data-types';
import {
  EARLIEST_POSTGRES_TIMESTAMP_MILLISECONDS,
  utcTimestamptzText,
} from './temporal-codec-helpers';

const TIMESTAMPTZ_TEXT =
  /^([+-]\d{6}|\d{4,6})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)( BC)?$/;

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
  const date = typeof wire === 'string' ? parseDate(wire) : undefined;
  if (date === undefined) throw invalidDate();
  return date;
}

/** The instant a timestamp with time zone as PostgreSQL writes it names, or `undefined` when the text is not one. */
function parseDate(text: string): Date | undefined {
  const match = TIMESTAMPTZ_TEXT.exec(text);
  if (!match) return undefined;
  const [
    ,
    yearText = '',
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = '',
    sign,
    offsetHour = '0',
    offsetMinute = '0',
    offsetSecond = '0',
    era,
  ] = match;
  const year = era ? 1 - Number(yearText) : Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number(fraction.slice(0, 3).padEnd(3, '0'));
  // Gregorian calendars repeat every 400 years. Validate in a safe cycle so local
  // time cannot overflow Date's range before the timezone offset is applied.
  const cycles = Math.floor((year - 2000) / 400);
  const safeYear = year - cycles * 400;
  const local = new Date(0);
  local.setUTCFullYear(safeYear, month, day);
  local.setUTCHours(hour, minute, second, milliseconds);
  if (
    (era !== undefined && (Number(yearText) === 0 || /^[+-]/.test(yearText))) ||
    local.getUTCFullYear() !== safeYear ||
    local.getUTCMonth() !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    Number(offsetHour) > 15 ||
    Number(offsetMinute) > 59 ||
    Number(offsetSecond) > 59
  )
    return undefined;
  const offset =
    (Number(offsetHour) * 3600 + Number(offsetMinute) * 60 + Number(offsetSecond)) *
    (sign === '-' ? -1 : 1);
  const value = new Date(local.getTime() - offset * 1000 + cycles * 146097 * 86400000);
  return isRepresentable(value) ? value : undefined;
}

/** The canonical instant a stored timestamp with time zone names, or `undefined` for `infinity` and an instant outside the range a `Date` holds. */
function canonicalInstant(text: string): string | undefined {
  if (text === 'infinity' || text === '-infinity') return undefined;
  try {
    return pgTimestamptzCanonical(text);
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') return undefined;
    throw error;
  }
}

/** The `Date` a stored timestamp with time zone names. A `Date` holds neither `infinity` nor an instant before 4714-11-24 BC or after +275760-09-13, so those are refused. */
function dateOfStoredText(codecId: string, text: string): Date {
  const canonical = canonicalInstant(text);
  const date = canonical === undefined ? undefined : new Date(canonical);
  if (date === undefined || !isRepresentable(date)) {
    return refuseJsonValue(
      codecId,
      'a timestamp with time zone a Date holds: not infinity, and from 4714-11-24 BC to +275760-09-13',
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
    return this.dataTypeValueOf(pgTimestamptzCanonical(validateDate(input).toISOString()));
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
  override renderOutputType(_params: PrecisionParams): string {
    return 'Date';
  }
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestamptzDateCodec {
    return () => new PgTimestamptzDateCodec(this, pgTimestamptz, params ?? {});
  }
}

export const pgTimestamptzDateDescriptor = new PgTimestamptzDateDescriptor();

export const pgTimestamptzDateColumn = (params: PrecisionParams = {}) =>
  column(pgTimestamptzDateDescriptor.factory(params), pgTimestamptzDateDescriptor.codecId, params);

pgTimestamptzDateColumn satisfies ColumnHelperFor<PgTimestamptzDateDescriptor>;
pgTimestamptzDateColumn satisfies ColumnHelperForStrict<PgTimestamptzDateDescriptor>;
