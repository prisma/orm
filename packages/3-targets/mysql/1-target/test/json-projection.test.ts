import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  mysqlBigintDescriptor,
  mysqlDatetimeDescriptor,
  mysqlEnumDescriptor,
  mysqlIntDescriptor,
  mysqlSqlCharDescriptor,
  mysqlSqlRawDescriptor,
  mysqlSqlVarcharDescriptor,
  mysqlTextDescriptor,
} from '../src/core/codecs';

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

  it('refuses a raw column, whose JSON form no codec knows', () => {
    expect(() =>
      mysqlSqlRawDescriptor.projectJson(column, {
        codecId: 'sql/raw@1',
        typeParams: { sql: 'point' },
      }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.AST_UNSUPPORTED' }));
  });

  it('refuses a stored array, which MySQL has no codec for', () => {
    expect(() =>
      mysqlIntDescriptor.projectJson(column, { codecId: 'mysql/int@1', many: true }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED' }));
  });
});
