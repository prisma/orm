import { describe, expect, it } from 'vitest';
import { buildModels, type ColumnShape, fieldText, INT_COLUMN, table } from './print-support';

function printedType(column: ColumnShape): string | undefined {
  const [model] = buildModels({
    models: {
      Event: { table: 'Event', fields: { id: { column: 'id' }, at: { column: 'at' } } },
    },
    tables: {
      Event: table({ columns: { id: INT_COLUMN, at: column }, primaryKey: { columns: ['id'] } }),
    },
  });
  const field = model?.fields[1];
  return field === undefined ? undefined : fieldText(field).replace(/^at /, '');
}

const column = (dataType: string, codecId: string, precision?: number): ColumnShape => ({
  dataType,
  codecId,
  nullable: false,
  ...(precision === undefined ? {} : { typeParams: { precision } }),
});

describe('contract print writes a date or time column as the convenience type it becomes', () => {
  it.each([
    [column('pg/timestamptz', 'pg/timestamptz-date@1', 3), 'DateTime'],
    [column('pg/timestamptz', 'pg/timestamptz-date@1', 6), 'DateTime(precision: 6)'],
    [column('pg/timestamp', 'pg/timestamp-date@1', 3), 'DateTime(storage: timestamp)'],
    [column('pg/timestamptz', 'pg/timestamptz-temporal@1'), 'DateTime(as: temporal)'],
    [column('pg/timestamptz', 'pg/timestamptz-string@1', 3), 'DateTime(as: string, precision: 3)'],
    [
      column('pg/timestamp', 'pg/timestamp-instant@1'),
      'DateTime(as: temporal, storage: timestamp)',
    ],
    [column('pg/date', 'pg/date-string@1'), 'Date'],
    [column('pg/date', 'pg/date-temporal@1'), 'Date(as: temporal)'],
    [column('pg/time', 'pg/time-string@1', 0), 'Time(precision: 0)'],
    [column('pg/timetz', 'pg/timetz@1'), 'Time(storage: timetz)'],
    [column('pg/timetz', 'pg/timetz@1', 3), 'Time(storage: timetz, precision: 3)'],
    [column('pg/interval', 'pg/interval-string@1'), 'Duration'],
    [column('pg/interval', 'pg/interval@1'), 'Duration(as: parts)'],
  ])('%j prints as %s', (shape, expected) => {
    expect(printedType(shape)).toBe(expected);
  });

  it('writes the explicit type for a column no convenience call becomes exactly', () => {
    expect([
      printedType(column('pg/timestamp', 'pg/timestamp-temporal@1', 3)),
      printedType(column('pg/timestamptz', 'pg/timestamptz-date@1')),
    ]).toEqual(['TimestampTemporal(3)', 'TimestamptzJsDate']);
  });
});

const scalar = (dataType: string, codecId: string, typeParams?: Record<string, number>) => ({
  dataType,
  codecId,
  nullable: false,
  ...(typeParams === undefined ? {} : { typeParams }),
});

describe('contract print writes a scalar column as the convenience type it becomes', () => {
  it.each([
    [scalar('pg/int4', 'pg/int4@1'), 'Int'],
    [scalar('pg/int2', 'pg/int2@1'), 'Int(storage: int2)'],
    [scalar('pg/int8', 'pg/int8@1'), 'BigInt'],
    [scalar('pg/int8', 'pg/int8number@1'), 'BigInt(as: number)'],
    [scalar('pg/numeric', 'pg/unboundedint@1'), 'BigInt(storage: numeric)'],
    [scalar('pg/float8', 'pg/float8@1'), 'Float'],
    [scalar('pg/float4', 'pg/float4@1'), 'Float(storage: float4)'],
    [scalar('pg/numeric', 'pg/numeric@1'), 'Decimal'],
    [
      scalar('pg/numeric', 'pg/numeric@1', { precision: 10, scale: 2 }),
      'Decimal(precision: 10, scale: 2)',
    ],
    [scalar('pg/text', 'pg/text@1'), 'String'],
    [scalar('pg/varchar', 'sql/varchar@1'), 'String(storage: varchar)'],
    [scalar('pg/varchar', 'sql/varchar@1', { length: 12 }), 'String(storage: varchar, length: 12)'],
    [scalar('pg/char', 'sql/char@1', { length: 3 }), 'String(storage: char, length: 3)'],
    [scalar('pg/bool', 'pg/bool@1'), 'Boolean'],
    [scalar('pg/bytea', 'pg/bytea@1'), 'Bytes'],
  ])('%j prints as %s', (shape, expected) => {
    expect(printedType(shape)).toBe(expected);
  });
});
