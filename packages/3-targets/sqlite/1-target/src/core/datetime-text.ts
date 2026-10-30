import {
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteDate,
  sqliteDatetime,
  sqliteText,
  sqliteTime,
} from './data-types';

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
  [sqliteDatetime.id, SQLITE_NOW_EXPRESSION],
  [sqliteDate.id, SQLITE_DATE_NOW_EXPRESSION],
  [sqliteTime.id, SQLITE_TIME_NOW_EXPRESSION],
  [sqliteText.id, SQLITE_NOW_EXPRESSION],
  [sqliteCharacter.id, SQLITE_NOW_EXPRESSION],
  [sqliteCharacterVarying.id, SQLITE_NOW_EXPRESSION],
]);

/**
 * The expression a `now()` default is written as on a column of `dataTypeId`: the current date or time of day on `sqlite/date` and `sqlite/time`, the current instant on `sqlite/datetime`, on text and on a column of no known data type. `undefined` on a data type that holds no current date or time, such as `sqlite/duration` or `sqlite/integer`, as PostgreSQL refuses `now()` on an `interval` or an `integer` column.
 */
export function sqliteNowExpressionFor(dataTypeId: string | undefined): string | undefined {
  return dataTypeId === undefined
    ? SQLITE_NOW_EXPRESSION
    : NOW_EXPRESSION_BY_DATA_TYPE.get(dataTypeId);
}
