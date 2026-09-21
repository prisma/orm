import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import { CastExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PostgresCodecDescriptor } from './codec-descriptor';
import { type PrecisionParams, precisionParamsSchema } from './codec-helpers';
import { PG_TIMESTAMPTZ_DATE_CODEC_ID } from './codec-ids';
import { pgTimestamptz } from './data-types';
import { PG_TIMESTAMPTZ_NATIVE_TYPE } from './temporal-codec-helpers';

const TIMESTAMPTZ_TEXT =
  /^(\d{4,6})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)( BC)?$/;

const MIN_TIMESTAMPTZ_MILLISECONDS = new Date('-004713-11-24T00:00:00.000Z').getTime();

function invalidDate(): RangeError {
  return new RangeError(
    `${PG_TIMESTAMPTZ_DATE_CODEC_ID} requires a valid Date or a representable ISO PostgreSQL timestamp with time zone; use TimestamptzString for unsupported values`,
  );
}

function validateDate(value: Date): Date {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getTime() < MIN_TIMESTAMPTZ_MILLISECONDS
  )
    throw invalidDate();
  return value;
}

function decodeDate(wire: unknown): Date {
  const match = typeof wire === 'string' ? TIMESTAMPTZ_TEXT.exec(wire) : null;
  if (!match) throw invalidDate();
  const [
    ,
    yearText,
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
    Number(yearText) === 0 ||
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
    throw invalidDate();
  const offset =
    (Number(offsetHour) * 3600 + Number(offsetMinute) * 60 + Number(offsetSecond)) *
    (sign === '-' ? -1 : 1);
  const value = new Date(local.getTime() - offset * 1000 + cycles * 146097 * 86400000);
  return validateDate(value);
}

function encodeDate(value: Date): string {
  validateDate(value);
  const iso = value.toISOString();
  const year = value.getUTCFullYear();
  if (year > 0 && year < 10000) return iso;
  const dateAndTime = iso.slice(year === 0 ? 4 : 7);
  return `${String(year <= 0 ? 1 - year : year).padStart(4, '0')}${dateAndTime}${year <= 0 ? ' BC' : ''}`;
}

export class PgTimestamptzDateCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
    return encodeDate(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return decodeDate(wire);
  }
  encodeJson(value: Date): JsonValue {
    return encodeDate(value);
  }
  decodeJson(json: JsonValue): Date {
    return decodeDate(json);
  }
}

export class PgTimestamptzDateDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgTimestamptz.id;
  override readonly codecId = PG_TIMESTAMPTZ_DATE_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(_params: PrecisionParams): string {
    return 'Date';
  }
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzDateCodec {
    return () => new PgTimestamptzDateCodec(this);
  }
}

export const pgTimestamptzDateDescriptor = new PgTimestamptzDateDescriptor();

export const pgTimestamptzDateColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzDateDescriptor.factory(params),
    pgTimestamptzDateDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzDateColumn satisfies ColumnHelperFor<PgTimestamptzDateDescriptor>;
pgTimestamptzDateColumn satisfies ColumnHelperForStrict<PgTimestamptzDateDescriptor>;
