import { sqliteDate, sqliteTime } from './data-types';

/** The `strftime` format for the text `encodeSqliteDatetime` writes. */
export const SQLITE_DATETIME_TEXT_FORMAT = '%Y-%m-%dT%H:%M:%fZ';

/** The SQLite expression for the current instant, as the text `encodeSqliteDatetime` writes. */
export const SQLITE_NOW_EXPRESSION = `strftime('${SQLITE_DATETIME_TEXT_FORMAT}','now')`;

/** The SQLite expression for the current date in UTC, as `sqlite/date` stores it. */
export const SQLITE_DATE_NOW_EXPRESSION = "date('now')";

/** The `strftime` format for the text `sqlite/time` stores. */
export const SQLITE_TIME_TEXT_FORMAT = '%H:%M:%f';

/** The SQLite expression for the current time of day in UTC, as `sqlite/time` stores it. */
export const SQLITE_TIME_NOW_EXPRESSION = `strftime('${SQLITE_TIME_TEXT_FORMAT}','now')`;

const NOW_EXPRESSION_BY_DATA_TYPE: ReadonlyMap<string, string> = new Map([
  [sqliteDate.id, SQLITE_DATE_NOW_EXPRESSION],
  [sqliteTime.id, SQLITE_TIME_NOW_EXPRESSION],
]);

/** The expression a `now()` default is written as on a column of `dataTypeId`: the current date or time of day on `sqlite/date` and `sqlite/time`, else the current instant. */
export function sqliteNowExpressionFor(dataTypeId: string | undefined): string {
  return (
    (dataTypeId === undefined ? undefined : NOW_EXPRESSION_BY_DATA_TYPE.get(dataTypeId)) ??
    SQLITE_NOW_EXPRESSION
  );
}
