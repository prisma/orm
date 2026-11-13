import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  renderSqlTypeName,
  resolveReportedSqlType,
  sqlStorageType,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import {
  mysqlDataTypes,
  mysqlDate,
  mysqlDateText,
  mysqlDuration,
  mysqlDurationText,
  mysqlTime,
  mysqlTimestamp,
  mysqlTimestampText,
  mysqlTimeText,
  mysqlVarchar,
} from '../src/core/data-types';

const lookup = createDataTypeLookup(mysqlDataTypes);

describe('the MySQL date and time data types', () => {
  it.each([
    [mysqlTimestamp, {}, 'timestamp'],
    [mysqlTimestamp, { precision: 6 }, 'timestamp(6)'],
    [mysqlDate, {}, 'date'],
    [mysqlTime, {}, 'time'],
    [mysqlTime, { precision: 6 }, 'time(6)'],
  ] as const)('writes %s with %j as %s', (type, params, text) => {
    expect(renderSqlTypeName(type, params)).toBe(text);
  });

  it.each([
    ['timestamp', 'mysql/timestamp', {}],
    ['timestamp(3)', 'mysql/timestamp', { precision: 3 }],
    ['date', 'mysql/date', {}],
    ['time', 'mysql/time', {}],
    ['time(6)', 'mysql/time', { precision: 6 }],
  ])('reads the reported type %s as %s', (text, id, typeParams) => {
    const resolved = resolveReportedSqlType(
      { text, kind: undefined, schema: undefined, name: undefined },
      mysqlDataTypes,
    );
    expect({ id: resolved?.dataType.id, typeParams: resolved?.typeParams }).toEqual({
      id,
      typeParams,
    });
  });

  it('normalizes a precision of 0 away, as MySQL prints it', () => {
    expect([
      mysqlTimestamp.sql.normalize({ precision: 0 }),
      mysqlTime.sql.normalize({ precision: 0 }),
    ]).toEqual([{}, {}]);
  });

  it('stores a duration in a varchar column, which MySQL can index', () => {
    expect(sqlStorageType(mysqlDuration, lookup)).toBe(mysqlVarchar);
  });

  it('stores a timestamp as ISO text without an offset, in the years MySQL holds', () => {
    expect(mysqlTimestampText('2024-01-01 10:00:00.500')).toBe('2024-01-01T10:00:00.5');
    expect(() => mysqlTimestampText('1969-12-31T23:59:59')).toThrow(
      /from 1970-01-01T00:00:01 to 2038-01-19T03:14:07.999999/,
    );
    expect(() => mysqlTimestampText('2024-01-01T00:00:00Z')).toThrow(/holds no UTC offset/);
  });

  it('stores a date as ISO text in the years 1000 to 9999', () => {
    expect(mysqlDateText('2024-02-29')).toBe('2024-02-29');
    expect(() => mysqlDateText('0999-12-31')).toThrow(/from 1000-01-01 to 9999-12-31/);
    expect(() => mysqlDateText('2023-02-29')).toThrow(/not a date that exists/);
  });

  it('stores a time of day with the fraction trimmed, and refuses an hour past 23 or digits below a microsecond', () => {
    expect(mysqlTimeText('09:30:00.500000')).toBe('09:30:00.5');
    expect(mysqlTimeText('09:30')).toBe('09:30:00');
    expect(() => mysqlTimeText('24:00:00')).toThrow(/not a time of day that exists/);
    expect(() => mysqlTimeText('09:30:00.1234567')).toThrow(/at most 6/);
  });

  it('stores a duration as written, refusing text that is no ISO 8601 duration', () => {
    expect([mysqlDurationText('PT1H30M'), mysqlDurationText('-P1W')]).toEqual(['PT1H30M', '-P1W']);
    expect(() => mysqlDurationText('1 hour')).toThrow(/ISO 8601 duration/);
  });

  it.each([
    [mysqlTimestamp, '2024-01-01T10:00:00', 'ISO 8601 date and time text'],
    [mysqlDate, '2024-02-29', 'ISO 8601 date text'],
    [mysqlTime, '09:30:00', 'ISO 8601 time of day text'],
    [mysqlDuration, 'PT1H', 'an ISO 8601 duration'],
  ] as const)('reads the stored value of %s and refuses others', (type, stored, expected) => {
    expect(type.fromContract(stored, {}).value).toBe(stored);
    expect(() => type.fromContract(42, {})).toThrow(expected);
  });

  it('respells a written date, time or timestamp in its stored form, and keeps a duration as written', () => {
    expect([
      mysqlTimestamp.valueFrom('2024-01-01 10:00:00.000', {}).value,
      mysqlDate.valueFrom('2024-02-29', {}).value,
      mysqlTime.valueFrom('09:30', {}).value,
      mysqlDuration.valueFrom('PT60M', {}).value,
    ]).toEqual(['2024-01-01T10:00:00', '2024-02-29', '09:30:00', 'PT60M']);
  });
});
