import { dataType } from '@internal/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { type ReportedSqlType, resolveReportedSqlType, sqlDataType } from '../src/sql-data-type';
import { allTypes } from './sql-data-type-fixtures';

function reported(text: string, rest: Partial<ReportedSqlType> = {}): ReportedSqlType {
  return { text, kind: undefined, schema: undefined, name: undefined, ...rest };
}

describe('resolveReportedSqlType', () => {
  it('claims a catalog text and a text with neither mark', () => {
    expect(resolveReportedSqlType(reported('integer'), allTypes)).toEqual({
      dataType: 't/int4',
      typeParams: {},
    });
    expect(resolveReportedSqlType(reported('int'), allTypes)).toEqual({
      dataType: 't/int4',
      typeParams: {},
    });
  });

  it('reads the placeholders as integers and returns their normal form', () => {
    expect(resolveReportedSqlType(reported('numeric(10,2)'), allTypes)).toEqual({
      dataType: 't/numeric',
      typeParams: { precision: 10, scale: 2 },
    });
    expect(resolveReportedSqlType(reported('decimal(10)'), allTypes)).toEqual({
      dataType: 't/numeric',
      typeParams: { precision: 10, scale: 0 },
    });
    expect(resolveReportedSqlType(reported('character(5)'), allTypes)).toEqual({
      dataType: 't/char',
      typeParams: { length: 5 },
    });
    expect(resolveReportedSqlType(reported('timestamp(3) without time zone'), allTypes)).toEqual({
      dataType: 't/timestamp',
      typeParams: { precision: 3 },
    });
  });

  it('ignores letter case', () => {
    expect(resolveReportedSqlType(reported('INTEGER'), allTypes)?.dataType).toBe('t/int4');
    expect(resolveReportedSqlType(reported('Double Precision'), allTypes)?.dataType).toBe(
      't/float8',
    );
    expect(resolveReportedSqlType(reported('geometry(Geometry,4326)'), allTypes)).toEqual({
      dataType: 't/geometry',
      typeParams: { srid: 4326 },
    });
  });

  it('ignores extra spaces around and between words', () => {
    expect(resolveReportedSqlType(reported('  double   precision '), allTypes)?.dataType).toBe(
      't/float8',
    );
    expect(
      resolveReportedSqlType(reported('timestamp(3)   without\ttime  zone'), allTypes)?.dataType,
    ).toBe('t/timestamp');
  });

  it('ignores spaces after an opening bracket or a comma and before a closing bracket', () => {
    expect(resolveReportedSqlType(reported('numeric( 10, 2 )'), allTypes)).toEqual({
      dataType: 't/numeric',
      typeParams: { precision: 10, scale: 2 },
    });
  });

  it('keeps a space before an opening bracket or a comma', () => {
    expect(resolveReportedSqlType(reported('numeric (10,2)'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('numeric(10 ,2)'), allTypes)).toBeUndefined();
  });

  it('leaves quoted text as written, so a quoted name matches no declared text', () => {
    expect(resolveReportedSqlType(reported('char'), allTypes)?.dataType).toBe('t/char');
    expect(resolveReportedSqlType(reported('"char"'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('"CHAR"'), allTypes)).toBeUndefined();
  });

  it('does not claim a text that is only written', () => {
    expect(resolveReportedSqlType(reported('int4'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('numeric(10)'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('character'), allTypes)).toBeUndefined();
  });

  it('claims a reported kind through claimsKind and fromReported, ignoring texts', () => {
    const status = reported('status', { kind: 'enum', schema: 'app', name: 'status' });
    expect(resolveReportedSqlType(status, allTypes)).toEqual({
      dataType: 't/enum',
      typeParams: { typeName: 'app.status' },
    });
    const integerKind = reported('integer', { kind: 'domain', schema: 'public', name: 'int' });
    expect(resolveReportedSqlType(integerKind, allTypes)).toBeUndefined();
  });

  it('returns nothing when the parameters a kind claim reads fail the schema', () => {
    const unnamed = reported('', { kind: 'enum', schema: 'public', name: '' });
    expect(resolveReportedSqlType(unnamed, allTypes)).toBeUndefined();
  });

  it('returns the normal form of the parameters a kind claim reads', () => {
    const range = sqlDataType<{ readonly precision?: number }>('t/range', {
      read: (json) => json,
      params: type({ 'precision?': 'number.integer >= 0' }),
      claimsKind: 'range',
      fromReported: () => ({}),
      normalize: (params) =>
        params.precision === undefined ? { ...params, precision: 6 } : params,
    });
    expect(resolveReportedSqlType(reported('tsrange', { kind: 'range' }), [range])).toEqual({
      dataType: 't/range',
      typeParams: { precision: 6 },
    });
  });

  it('returns nothing for a text no type claims', () => {
    expect(resolveReportedSqlType(reported('bpchar'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('interval year to month'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('text[]'), allTypes)).toBeUndefined();
  });

  it('returns nothing when the parameters fail the schema', () => {
    expect(resolveReportedSqlType(reported('numeric(0,0)'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('timestamp(7) without time zone'), allTypes)).toBe(
      undefined,
    );
    expect(resolveReportedSqlType(reported('vector(0)'), allTypes)).toBeUndefined();
  });

  it('passes over data types that are not SQL data types', () => {
    const plain = dataType('t/plain', { read: (json) => json });
    expect(resolveReportedSqlType(reported('integer'), [plain, ...allTypes])?.dataType).toBe(
      't/int4',
    );
  });

  it('matches a whole text, not a prefix or a suffix', () => {
    expect(resolveReportedSqlType(reported('integer[]'), allTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('my integer'), allTypes)).toBeUndefined();
  });
});
