/**
 * PostgreSQL's year text (ADR 254, "Date and time types"). PostgreSQL reads and prints no signed year: a year after 9999 is written without its sign and leading zeros, `10000-01-01`, and a year at or before ISO year 0000 with a ` BC` suffix and PostgreSQL's year number, which has no year 0, so ISO year 0000 is `0001 BC` and -000043 is `0044 BC`. Every Postgres date and time codec and tag converts years through these two functions.
 */

const POSTGRES_YEAR = /^(\d{4,6})(-.*?)( BC)?$/;
const ISO_YEAR = /^([+-]\d{6}|\d{4})(-.*)$/;
const BC_SUFFIX = ' BC';

/** ISO 8601 text, with a four-digit or signed six-digit year, from text PostgreSQL prints. Text with no year, ISO text and `0000 BC`, which does not exist, stay as they are. */
export function isoYearText(text: string): string {
  const match = POSTGRES_YEAR.exec(text);
  if (match === null) return text;
  const [, digits = '', rest = '', bc] = match;
  const year = Number(digits);
  if (bc !== undefined) {
    if (year === 0) return text;
    return `${isoYear(1 - year)}${rest}`;
  }
  return digits.length > 4 ? `${isoYear(year)}${rest}` : text;
}

/** The text PostgreSQL reads for ISO 8601 text with a four-digit or signed six-digit year. Text with no year stays as it is. */
export function postgresYearText(text: string): string {
  const match = ISO_YEAR.exec(text);
  if (match === null) return text;
  const [, yearDigits = '', rest = ''] = match;
  const year = Number(yearDigits);
  if (year > 9999) return `${year}${rest}`;
  if (year >= 1) return `${String(year).padStart(4, '0')}${rest}`;
  return `${String(1 - year).padStart(4, '0')}${rest}${BC_SUFFIX}`;
}

function isoYear(year: number): string {
  if (year >= 0 && year <= 9999) return String(year).padStart(4, '0');
  return `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
}
