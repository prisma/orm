import { pgDate, pgTime, pgTimestamp, pgTimestamptz, pgTimetz } from './data-types';

const RFC_3339 = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * What a Prisma 7 `DateTime` default, such as `2024-01-02T03:04:05.123+02:00`, means on a column of `dataType`, as the body of the type's tag: `date` keeps the written date, `time` and `timestamp` the written wall-clock time without the offset, `timetz` the time with the written offset, and `timestamptz` the written instant, offset included. The tag reads the body as Postgres reads the default Prisma 7 writes. `undefined` for text that is not an RFC 3339 date and time, or a type that is not a date or time type.
 */
export function prisma7TemporalTagBody(text: string, dataType: string): string | undefined {
  const match = RFC_3339.exec(text);
  if (match === null) return undefined;
  const [, date = '', clock = '', zone = ''] = match;
  const offset = zone.toUpperCase();
  switch (dataType) {
    case pgDate.id:
      return date;
    case pgTime.id:
      return clock;
    case pgTimetz.id:
      return `${clock}${offset}`;
    case pgTimestamp.id:
      return `${date}T${clock}`;
    case pgTimestamptz.id:
      return `${date}T${clock}${offset}`;
    default:
      return undefined;
  }
}

const MICROSECONDS_PER_SECOND = 1_000_000n;
const POSTGRES_EPOCH_MS = Date.UTC(2000, 0, 1);

/**
 * The value PostgreSQL stores for a Prisma 7 `DateTime` default with more fraction digits than a column of `dataType` with `precision` holds, written in the same RFC 3339 form: the fraction is first rounded to microseconds as PostgreSQL reads text, then to `precision` digits as it rounds a value for its column, a tie going away from midnight on 2000-01-01, PostgreSQL's epoch. `undefined` when the column holds the text as written, or for a date column, which keeps only the date.
 */
export function prisma7TemporalStored(
  text: string,
  dataType: string,
  precision: number,
): string | undefined {
  const match = RFC_3339.exec(text);
  if (match === null || dataType === pgDate.id) return undefined;
  const [, date = '', clock = '', zone = ''] = match;
  const [hms = '', fraction = ''] = clock.split('.');
  if (fraction.length <= precision) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = hms.split(':').map(Number);
  const wallMs = new Date(0).setUTCFullYear(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const wall =
    (BigInt(wallMs - POSTGRES_EPOCH_MS) / 1000n +
      BigInt((hour ?? 0) * 3600 + (minute ?? 0) * 60 + (second ?? 0))) *
      MICROSECONDS_PER_SECOND +
    microsecondsOf(fraction);
  const instant = dataType === pgTimestamptz.id ? wall - offsetMicroseconds(zone) : wall;
  const tieGoesEarlier =
    (dataType === pgTimestamp.id || dataType === pgTimestamptz.id) && instant < 0n;
  const stored = roundedTo(wall, 10n ** BigInt(6 - precision), tieGoesEarlier);
  return `${printedWall(stored, precision)}${zone}`;
}

/** PostgreSQL reads the fraction of a second as a double and rounds it to whole microseconds. */
function microsecondsOf(fraction: string): bigint {
  if (fraction.length <= 6) return BigInt(fraction.padEnd(6, '0'));
  const scaled = Number(`0.${fraction}`) * 1e6;
  const floor = Math.floor(scaled);
  const rest = scaled - floor;
  const rounded = rest > 0.5 || (rest === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
  return BigInt(rounded);
}

function offsetMicroseconds(zone: string): bigint {
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (offset === null) return 0n;
  const [, sign, hours = '0', minutes = '0'] = offset;
  const seconds = BigInt(Number(hours) * 3600 + Number(minutes) * 60);
  return (sign === '-' ? -seconds : seconds) * MICROSECONDS_PER_SECOND;
}

function roundedTo(value: bigint, step: bigint, tieGoesEarlier: boolean): bigint {
  const rest = ((value % step) + step) % step;
  const below = value - rest;
  const twice = rest * 2n;
  if (twice > step || (twice === step && !tieGoesEarlier)) return below + step;
  return below;
}

function printedWall(microseconds: bigint, precision: number): string {
  const rest =
    ((microseconds % MICROSECONDS_PER_SECOND) + MICROSECONDS_PER_SECOND) % MICROSECONDS_PER_SECOND;
  const seconds = (microseconds - rest) / MICROSECONDS_PER_SECOND;
  const at = new Date(POSTGRES_EPOCH_MS + Number(seconds) * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${String(at.getUTCFullYear()).padStart(4, '0')}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  const clock = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`;
  const fraction = precision === 0 ? '' : `.${String(rest).padStart(6, '0').slice(0, precision)}`;
  return `${day}T${clock}${fraction}`;
}
