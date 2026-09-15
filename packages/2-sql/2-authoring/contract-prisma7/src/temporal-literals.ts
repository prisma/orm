export type TemporalNativeType = 'timestamp' | 'timestamptz' | 'date' | 'time' | 'timetz';

const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const MICROS_PER_SECOND = 1_000_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Postgres reads fractional seconds with C's `rint`, which rounds a tie to the even neighbour. */
function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

function fractionText(micros: number): string {
  return micros === 0 ? '' : `.${pad(micros, 6).replace(/0+$/, '')}`;
}

function offsetText(minutes: number): string {
  const magnitude = Math.abs(minutes);
  const rest = magnitude % 60;
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(magnitude / 60))}${rest === 0 ? '' : `:${pad(rest)}`}`;
}

/**
 * The text of the column default Postgres stores for a Prisma 7 `DateTime`
 * default, which Prisma 7 writes as `'2024-01-02 03:04:05.123 +02:00'`:
 * `date` keeps the written date, `time` and `timestamp` the written wall-clock
 * time without the offset, `timetz` the time with the written offset, and
 * `timestamptz` the instant in UTC. Fractional seconds are rounded to
 * microseconds; the column's own precision does not change a stored default.
 */
export function storedTemporalText(
  text: string,
  nativeType: TemporalNativeType,
): string | undefined {
  const match = RFC_3339.exec(text);
  if (match === null) return undefined;
  const [
    ,
    year = '',
    month = '',
    day = '',
    hour,
    minute,
    second,
    fraction = '',
    sign,
    offsetHours,
    offsetMinutes,
  ] = match;
  if (nativeType === 'date') return `${year}-${month}-${day}`;

  const micros = roundHalfToEven(Number(`0.${fraction.slice(0, 9)}`) * MICROS_PER_SECOND);
  const clockSeconds =
    Number(hour) * 3600 +
    Number(minute) * 60 +
    Number(second) +
    Math.floor(micros / MICROS_PER_SECOND);
  const fractional = fractionText(micros % MICROS_PER_SECOND);
  const offsetMinutesTotal =
    sign === undefined
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes));

  if (nativeType === 'time' || nativeType === 'timetz') {
    const clock = `${pad(Math.floor(clockSeconds / 3600))}:${pad(Math.floor(clockSeconds / 60) % 60)}:${pad(clockSeconds % 60)}${fractional}`;
    return nativeType === 'time' ? clock : `${clock}${offsetText(offsetMinutesTotal)}`;
  }

  const midnight = new Date(0);
  midnight.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  const utcShift = nativeType === 'timestamptz' ? offsetMinutesTotal * 60 : 0;
  const stamp = new Date(midnight.getTime() + (clockSeconds - utcShift) * 1000);
  const wallClock = `${pad(stamp.getUTCFullYear(), 4)}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())} ${pad(stamp.getUTCHours())}:${pad(stamp.getUTCMinutes())}:${pad(stamp.getUTCSeconds())}${fractional}`;
  return nativeType === 'timestamptz' ? `${wallClock}+00` : wallClock;
}
