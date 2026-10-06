/** A contract written for an existing database reads every date and time column as PostgreSQL's text. */
export const EXISTING_COLUMN_DATE_TIME_TYPES = {
  timestamp: 'TimestampString',
  timestamptz: 'TimestamptzString',
  date: 'DateString',
  time: 'TimeString',
  timetz: 'Timetz',
} as const;
