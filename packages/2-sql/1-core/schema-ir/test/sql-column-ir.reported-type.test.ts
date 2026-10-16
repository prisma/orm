import { describe, expect, it } from 'vitest';
import { SqlColumnIR, type SqlColumnIRInput } from '../src/ir/sql-column-ir';

function reported(text: string): NonNullable<SqlColumnIRInput['reportedType']> {
  return { text, kind: undefined, schema: undefined, name: undefined };
}

/** A contract-derived column whose type is named by its catalog text. */
function expectedColumn(type: string, overrides: Partial<SqlColumnIRInput> = {}): SqlColumnIR {
  return new SqlColumnIR({
    name: 'c',
    nativeType: type,
    nullable: false,
    resolvedNativeType: type,
    reportedType: reported(type),
    ...overrides,
  });
}

function introspectedColumn(
  text: string,
  normalized: string,
  overrides: Partial<SqlColumnIRInput> = {},
): SqlColumnIR {
  return new SqlColumnIR({
    name: 'c',
    nativeType: normalized,
    nullable: false,
    resolvedNativeType: normalized,
    reportedType: { text, kind: undefined, schema: 'pg_catalog', name: text },
    ...overrides,
  });
}

describe('two columns that both carry a reported type', () => {
  const integerColumn = introspectedColumn('integer', 'int4');

  it('match when the reported texts match, whichever side is asked', () => {
    expect([
      expectedColumn('integer').isEqualTo(integerColumn),
      integerColumn.isEqualTo(expectedColumn('integer')),
      expectedColumn('integer').typeDiffersFrom(integerColumn),
    ]).toEqual([true, true, false]);
  });

  it('differ when the texts differ, even where the resolved types match, whichever side is asked', () => {
    const alias = expectedColumn('int4');
    expect([
      alias.isEqualTo(integerColumn),
      integerColumn.isEqualTo(alias),
      alias.typeDiffersFrom(integerColumn),
      integerColumn.typeDiffersFrom(alias),
    ]).toEqual([false, false, true, true]);
  });

  it('compare a list column by its element type and the list flag', () => {
    const tsvectors = introspectedColumn('tsvector', 'tsvector', {
      many: true,
      resolvedNativeType: 'tsvector[]',
    });
    expect([
      expectedColumn('tsvector', { many: true, resolvedNativeType: 'tsvector[]' }).isEqualTo(
        tsvectors,
      ),
      expectedColumn('tsvector').isEqualTo(tsvectors),
    ]).toEqual([true, false]);
  });

  it('still compare nullability', () => {
    expect(
      expectedColumn('integer').isEqualTo(
        introspectedColumn('integer', 'int4', { nullable: true }),
      ),
    ).toBe(false);
  });

  it('explain a type mismatch with both texts', () => {
    expect(expectedColumn('int4').explainMismatch(integerColumn)).toBe(
      'The column type is "int4", but the database reports "integer". A type named by its catalog text is compared with the text the database reports, exactly.',
    );
  });

  it('explain nothing when only the nullability differs', () => {
    expect(
      expectedColumn('integer').explainMismatch(
        introspectedColumn('integer', 'int4', { nullable: true }),
      ),
    ).toBeUndefined();
  });
});

describe('a column with no reported type', () => {
  it('compares the resolved types, ignoring the reported text of the other side', () => {
    const expected = new SqlColumnIR({
      name: 'c',
      nativeType: 'int4',
      nullable: false,
      resolvedNativeType: 'int4',
    });
    const actual = introspectedColumn('integer', 'int4');
    expect([
      expected.isEqualTo(actual),
      actual.isEqualTo(expected),
      expected.typeDiffersFrom(actual),
      expected.explainMismatch(actual),
    ]).toEqual([true, true, false, undefined]);
  });
});
