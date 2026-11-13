/**
 * Normalizes a PostgreSQL TIMESTAMPTZ string by replacing the space separator
 * between date and time components with 'T' (ISO 8601).
 *
 * Example: '2024-01-15 08:30:00+05:30' -> '2024-01-15T08:30:00+05:30'
 */
export function normalizeTimestamptz(time: string): string {
  return time.replace(' ', 'T')
}

/**
 * Normalizes a PostgreSQL TIMESTAMP string by replacing the space separator
 * with 'T' and appending a UTC offset ('+00:00'), producing an RFC 3339 string.
 *
 * Example: '1996-12-19 16:39:57' -> '1996-12-19T16:39:57+00:00'
 */
export function normalizeTimestamp(time: string): string {
  return `${time.replace(' ', 'T')}+00:00`
}
