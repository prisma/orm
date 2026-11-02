/** Whether `value` is a `Date` that holds an instant, not an Invalid Date. */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Whether ISO text has nonzero digits below a millisecond, which a `Date` drops. */
export function hasDigitsBelowAMillisecond(text: string): boolean {
  return /[1-9]/.test(/\.(\d+)/.exec(text)?.[1]?.slice(3) ?? '');
}

/** `value` in UTC as `Date.toISOString` writes it, or `undefined` for an Invalid Date or one before `earliestMilliseconds`. */
export function utcIsoTextOf(value: Date, earliestMilliseconds: number): string | undefined {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < earliestMilliseconds) return undefined;
  return value.toISOString();
}
