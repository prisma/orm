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
