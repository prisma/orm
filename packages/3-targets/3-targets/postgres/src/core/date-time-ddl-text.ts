import { pgDate, pgInterval, pgTime, pgTimestamp, pgTimestamptz, pgTimetz } from './data-types';

const DATE_TIME_TYPES: ReadonlySet<string> = new Set([
  pgDate.id,
  pgTime.id,
  pgTimetz.id,
  pgTimestamp.id,
  pgTimestamptz.id,
  pgInterval.id,
]);

const TYPES_WITH_A_YEAR: ReadonlySet<string> = new Set([
  pgDate.id,
  pgTimestamp.id,
  pgTimestamptz.id,
]);

/** Whether a data type is one of this target's date and time types, whose defaults DDL writes as text. */
export function isPostgresDateTimeDataType(dataTypeId: string | undefined): boolean {
  return dataTypeId !== undefined && DATE_TIME_TYPES.has(dataTypeId);
}

/**
 * The text DDL writes for a default of a date or time type, from its canonical form (ADR 254). A
 * year from 1 to 9999 stays as it is. PostgreSQL has no year 0 and reads no signed year, so a later
 * year loses its sign and leading zeros (`10000-01-01`) and a year at or before 0 is written as the
 * year before Christ (`0044-03-15 BC`). Every Postgres DDL path writes a date or time default
 * through this function.
 */
export function postgresDateTimeDdlText(canonical: string, dataTypeId: string | undefined): string {
  if (dataTypeId === undefined || !TYPES_WITH_A_YEAR.has(dataTypeId)) return canonical;
  const match = /^([+-]\d{6}|\d{4})(-.*)$/.exec(canonical);
  if (match === null) return canonical;
  const [, yearDigits = '', rest = ''] = match;
  const year = Number(yearDigits);
  if (year >= 1 && year <= 9999) return canonical;
  if (year > 9999) return `${year}${rest}`;
  return `${String(1 - year).padStart(4, '0')}${rest} BC`;
}
