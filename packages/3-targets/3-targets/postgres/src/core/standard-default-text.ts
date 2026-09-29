import { postgresStandardTextByDataType } from './data-types';
import { postgresCodecDescriptorRegistry } from './registry';

/**
 * A standard text with its year as PostgreSQL reads it: a year from 1 to 9999 stays as it is, a
 * larger one loses its sign and leading zeros, and a year at or before 0 is written as the year
 * before Christ with a ` BC` suffix, because PostgreSQL has no year 0 and reads no signed year.
 * Text with no date, and `infinity`, are returned unchanged.
 */
function postgresYearText(standard: string): string {
  const match = /^([+-]\d{6}|\d{4})(-.*)$/.exec(standard);
  if (match === null) return standard;
  const [, yearDigits = '', rest = ''] = match;
  const year = Number(yearDigits);
  if (year >= 1 && year <= 9999) return standard;
  if (year > 9999) return `${year}${rest}`;
  return `${String(1 - year).padStart(4, '0')}${rest} BC`;
}

/**
 * The standard-text function of the data type a codec represents, when that type is one of the
 * date and time types, which store one standard text for each value.
 */
export function postgresStandardTextOfCodec(
  codecId: string,
): ((text: string) => string) | undefined {
  const dataType = postgresCodecDescriptorRegistry.descriptorFor(codecId)?.dataType;
  return dataType === undefined ? undefined : postgresStandardTextByDataType.get(dataType);
}

/**
 * The text a DDL default writes for a date or time value: the standard text, with a year outside
 * 1 to 9999 written the way PostgreSQL reads it (`0044-03-15 BC`, `10000-01-01`). Every DDL path
 * writes a date or time default through this function, so one default is one SQL literal. Text the
 * column's type does not read, and a value of any other type, is written as it is.
 */
export function postgresDefaultLiteralText(text: string, codecId: string | undefined): string {
  const standardText = codecId === undefined ? undefined : postgresStandardTextOfCodec(codecId);
  if (standardText === undefined) return text;
  try {
    return postgresYearText(standardText(text));
  } catch {
    return text;
  }
}
