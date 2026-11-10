import { dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { SqlColumnIR, type SqlColumnIRInput, sqlColumnTypesEqual } from '../src/ir/sql-column-ir';

const raw = dataType('sql/raw', { read: (json) => json });
const int4 = dataType('t/int4', { read: (json) => json });

/** A contract-derived column whose type is named by its catalog text. */
function expectedColumn(text: string, overrides: Partial<SqlColumnIRInput> = {}): SqlColumnIR {
  return new SqlColumnIR({
    name: 'c',
    typeText: text,
    nullable: false,
    storedType: raw,
    storedTypeParams: { sql: text },
    catalogText: text,
    ...overrides,
  });
}

function introspectedColumn(text: string, overrides: Partial<SqlColumnIRInput> = {}): SqlColumnIR {
  return new SqlColumnIR({
    name: 'c',
    typeText: text,
    nullable: false,
    reportedType: { text, kind: undefined, schema: 'pg_catalog', name: text },
    ...overrides,
  });
}

describe('a column whose type is named by its catalog text', () => {
  const integerColumn = introspectedColumn('integer', { storedType: int4, storedTypeParams: {} });

  it('matches a column the database reports with the same text, whichever side is asked, even where a data type claims it', () => {
    expect([
      expectedColumn('integer').isEqualTo(integerColumn),
      integerColumn.isEqualTo(expectedColumn('integer')),
      expectedColumn('ltree').isEqualTo(introspectedColumn('ltree')),
    ]).toEqual([true, true, true]);
  });

  it('differs from a column reported with another text, case included', () => {
    expect([
      expectedColumn('int4').isEqualTo(integerColumn),
      integerColumn.isEqualTo(expectedColumn('int4')),
      expectedColumn('LTREE').isEqualTo(introspectedColumn('ltree')),
    ]).toEqual([false, false, false]);
  });

  it('compares a list column with the reported element type and the list flag', () => {
    const tsvectors = introspectedColumn('tsvector', { many: true });
    expect([
      expectedColumn('tsvector', { many: true }).isEqualTo(tsvectors),
      expectedColumn('tsvector[]').isEqualTo(tsvectors),
      expectedColumn('tsvector').isEqualTo(tsvectors),
    ]).toEqual([true, true, false]);
  });

  it('matches another such column only when the texts match', () => {
    expect([
      sqlColumnTypesEqual(expectedColumn('circle'), expectedColumn('circle')),
      sqlColumnTypesEqual(expectedColumn('circle'), expectedColumn('tsvector')),
    ]).toEqual([true, false]);
  });

  it('differs from a contract column of any other data type', () => {
    const contractInteger = new SqlColumnIR({
      name: 'c',
      typeText: 'integer',
      nullable: false,
      storedType: int4,
      storedTypeParams: {},
    });
    expect(sqlColumnTypesEqual(expectedColumn('integer'), contractInteger)).toBe(false);
  });

  it('still compares nullability', () => {
    expect(
      expectedColumn('integer').isEqualTo(introspectedColumn('integer', { nullable: true })),
    ).toBe(false);
  });

  it('explains a type mismatch with both texts', () => {
    expect(expectedColumn('int4').explainMismatch(integerColumn)).toEqual({
      text: 'The column type is "int4", but the database reports "integer". A type named by its catalog text is compared with the text the database reports, exactly.',
      cause: 'differs',
    });
  });

  it('explains a mismatch with an unclaimed type by both texts', () => {
    expect(expectedColumn('ltree').explainMismatch(introspectedColumn('tsvector'))).toEqual({
      text: 'The column type is "ltree", but the database reports "tsvector". A type named by its catalog text is compared with the text the database reports, exactly.',
      cause: 'differs',
    });
  });
});
