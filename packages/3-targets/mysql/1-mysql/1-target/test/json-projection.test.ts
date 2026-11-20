import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  mysqlBigintDescriptor,
  mysqlBigintNumberDescriptor,
  mysqlDatetimeDescriptor,
  mysqlDoubleDescriptor,
  mysqlEnumDescriptor,
  mysqlIntDescriptor,
  mysqlSqlCharDescriptor,
  mysqlSqlRawDescriptor,
  mysqlSqlVarcharDescriptor,
  mysqlTextDescriptor,
} from '../src/core/codecs';
import {
  mysqlDateStringDescriptor,
  mysqlDateTemporalDescriptor,
  mysqlDatetimeStringDescriptor,
  mysqlDatetimeTemporalDescriptor,
  mysqlDurationStringDescriptor,
  mysqlTimeStringDescriptor,
  mysqlTimestampDateDescriptor,
  mysqlTimestampStringDescriptor,
  mysqlTimestampTemporalDescriptor,
  mysqlTimeTemporalDescriptor,
} from '../src/core/date-time-codecs';

const column = ColumnRef.of('rows', 'value');

describe('MySQL codecs project a column into JSON as the row form reads it', () => {
  it.each([
    ['mysql/int@1', mysqlIntDescriptor, undefined],
    ['mysql/text@1', mysqlTextDescriptor, undefined],
    ['sql/varchar@1', mysqlSqlVarcharDescriptor, { length: 191 }],
    ['sql/char@1', mysqlSqlCharDescriptor, { length: 2 }],
    ['mysql/enum@1', mysqlEnumDescriptor, { values: ['A', 'B'] }],
  ] as const)('passes %s through unchanged', (codecId, descriptor, typeParams) => {
    expect(descriptor.projectJson(column, { codecId, ...(typeParams ? { typeParams } : {}) })).toBe(
      column,
    );
  });

  it('renders a bigint as its decimal text, so a value past 2^53 keeps every digit', () => {
    expect(mysqlBigintDescriptor.projectJson(column, { codecId: 'mysql/bigint@1' })).toEqual(
      CastExpr.as(column, 'CHAR'),
    );
  });

  it('passes a datetime through, whose JSON text the codec reads as the row form', () => {
    expect(
      mysqlDatetimeDescriptor.projectJson(column, {
        codecId: 'mysql/datetime@1',
        typeParams: { precision: 3 },
      }),
    ).toBe(column);
  });

  it.each([
    ['mysql/datetime-temporal@1', mysqlDatetimeTemporalDescriptor, { precision: 6 }],
    ['mysql/datetime-string@1', mysqlDatetimeStringDescriptor, { precision: 6 }],
    ['mysql/timestamp-date@1', mysqlTimestampDateDescriptor, { precision: 3 }],
    ['mysql/timestamp-temporal@1', mysqlTimestampTemporalDescriptor, { precision: 6 }],
    ['mysql/timestamp-string@1', mysqlTimestampStringDescriptor, { precision: 6 }],
    ['mysql/date-string@1', mysqlDateStringDescriptor, undefined],
    ['mysql/date-temporal@1', mysqlDateTemporalDescriptor, undefined],
    ['mysql/time-string@1', mysqlTimeStringDescriptor, { precision: 6 }],
    ['mysql/time-temporal@1', mysqlTimeTemporalDescriptor, { precision: 6 }],
    ['mysql/duration-string@1', mysqlDurationStringDescriptor, { length: 191 }],
  ] as const)(
    'passes %s through, whose JSON text the codec reads as the row form',
    (codecId, descriptor, typeParams) => {
      expect(
        descriptor.projectJson(column, { codecId, ...(typeParams ? { typeParams } : {}) }),
      ).toBe(column);
    },
  );

  it('refuses a raw column, whose JSON form no codec knows', () => {
    expect(() =>
      mysqlSqlRawDescriptor.projectJson(column, {
        codecId: 'sql/raw@1',
        typeParams: { sql: 'point' },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.AST_UNSUPPORTED',
        message:
          'Reading a raw column inside an include is not yet supported on MySQL and MariaDB.',
        why: "An include reads its rows as JSON, and Prisma cannot yet write a raw column's value into that JSON on MySQL and MariaDB.",
        fix: "Leave the raw column out of the include's select, and read it with its own query.",
        meta: { feature: 'Reading a raw column inside an include' },
      }),
    );
  });

  it('refuses a stored array, which MySQL has no codec for', () => {
    expect(() =>
      mysqlIntDescriptor.projectJson(column, { codecId: 'mysql/int@1', many: true }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED' }));
  });
});

describe('MySQL number codecs project a column into JSON', () => {
  it('renders a bigint read as a number as its decimal text, so the codec sees every digit before it checks the range', () => {
    expect(
      mysqlBigintNumberDescriptor.projectJson(column, { codecId: 'mysql/bigintnumber@1' }),
    ).toEqual(CastExpr.as(column, 'CHAR'));
  });

  it('passes a double through, which both servers write into JSON as the shortest number that reads back as it', () => {
    expect(mysqlDoubleDescriptor.projectJson(column, { codecId: 'mysql/double@1' })).toBe(column);
  });
});
