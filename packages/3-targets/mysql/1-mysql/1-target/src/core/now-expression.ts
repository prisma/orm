import { sqlRawDataType } from '@internal/sql-contract/data-type';
import {
  mysqlChar,
  mysqlDate,
  mysqlDatetime,
  mysqlText,
  mysqlTime,
  mysqlTimestamp,
  mysqlVarchar,
} from './data-types';

/** The name of the current instant, as a contract writes it. */
export const MYSQL_INSTANT_NOW = 'now()';

/** The name a `now()` default on a `date` column reads back as: MySQL reports `curdate()`, which writes a date, not an instant. */
export const MYSQL_DATE_NOW = 'CURRENT_DATE';

/** The name a `now()` default on a `time` column reads back as: MySQL reports `curtime(p)`, which writes a time of day. */
export const MYSQL_TIME_NOW = 'CURRENT_TIME';

type CurrentValue = typeof MYSQL_INSTANT_NOW | typeof MYSQL_DATE_NOW | typeof MYSQL_TIME_NOW;

const CURRENT_VALUE_BY_DATA_TYPE: ReadonlyMap<string, CurrentValue> = new Map([
  [mysqlDatetime.id, MYSQL_INSTANT_NOW],
  [mysqlTimestamp.id, MYSQL_INSTANT_NOW],
  [mysqlDate.id, MYSQL_DATE_NOW],
  [mysqlTime.id, MYSQL_TIME_NOW],
  [mysqlText.id, MYSQL_INSTANT_NOW],
  [mysqlVarchar.id, MYSQL_INSTANT_NOW],
  [mysqlChar.id, MYSQL_INSTANT_NOW],
  [sqlRawDataType.id, MYSQL_INSTANT_NOW],
]);

/**
 * The current value a `now()` default writes on a column of `dataTypeId`: the current date on `mysql/date`, the current time of day on `mysql/time`, and the current instant on `datetime`, `timestamp`, text, a raw column, whose values Prisma does not read, and a column of no known data type. `undefined` on a data type that stores no date or time, such as `mysql/int` or `mysql/duration`, as PostgreSQL refuses `now()` on an `integer` or an `interval` column.
 */
export function mysqlCurrentValueFor(dataTypeId: string | undefined): CurrentValue | undefined {
  return dataTypeId === undefined ? MYSQL_INSTANT_NOW : CURRENT_VALUE_BY_DATA_TYPE.get(dataTypeId);
}

/** The MySQL expression for a current value, with the column's fraction digits, which MySQL requires to match the column's. */
export function mysqlNowExpression(current: CurrentValue, precision: number | undefined): string {
  const digits = precision === undefined || precision === 0 ? '' : `(${precision})`;
  switch (current) {
    case MYSQL_INSTANT_NOW:
      return `CURRENT_TIMESTAMP${digits}`;
    case MYSQL_DATE_NOW:
      return 'CURRENT_DATE';
    case MYSQL_TIME_NOW:
      return `CURRENT_TIME${digits}`;
  }
}
