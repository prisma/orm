import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';

const base = { tableName: 'User', columnName: 'role', many: false, memberValues: undefined };

describe('postgresRenderCheckExpressions', () => {
  it('renders a scalar domain enum as an IN membership predicate', () => {
    expect(postgresRenderCheckExpressions({ ...base, memberValues: ['user', 'admin'] })).toEqual([
      { kind: 'membership', columnName: 'role', expression: `"role" IN ('user', 'admin')` },
    ]);
  });

  it('renders integer, fractional, and negative scalar members without quotes', () => {
    expect(postgresRenderCheckExpressions({ ...base, memberValues: [1, 2.5, -3] })).toEqual([
      { kind: 'membership', columnName: 'role', expression: '"role" IN (1, 2.5, -3)' },
    ]);
  });

  it('compares numeric arrays with both operands cast to numeric[]', () => {
    expect(
      postgresRenderCheckExpressions({ ...base, many: true, memberValues: [1, 2.5, -3] }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'role',
        expression: '"role"::numeric[] <@ ARRAY[1, 2.5, -3]::numeric[]',
      },
      {
        kind: 'elementNotNull',
        columnName: 'role',
        expression: 'array_position("role", NULL) IS NULL',
      },
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite numeric member %s',
    (value) => {
      for (const many of [false, true]) {
        expect(() =>
          postgresRenderCheckExpressions({ ...base, many, memberValues: [1, value] }),
        ).toThrow(/non-finite numeric member/);
      }
    },
  );

  it('renders an array domain enum as an <@ containment predicate', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'roles',
        many: true,
        memberValues: ['user', 'admin'],
      }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'roles',
        expression: `"roles"::text[] <@ ARRAY['user', 'admin']::text[]`,
      },
      {
        kind: 'elementNotNull',
        columnName: 'roles',
        expression: `array_position("roles", NULL) IS NULL`,
      },
    ]);
  });

  it('renders element-non-null only for a list column with no member set', () => {
    expect(postgresRenderCheckExpressions({ ...base, columnName: 'tags', many: true })).toEqual([
      {
        kind: 'elementNotNull',
        columnName: 'tags',
        expression: `array_position("tags", NULL) IS NULL`,
      },
    ]);
  });

  it('renders nothing for a plain scalar column', () => {
    expect(postgresRenderCheckExpressions(base)).toEqual([]);
  });

  it('throws on an empty member set for a scalar column', () => {
    expect(() => postgresRenderCheckExpressions({ ...base, memberValues: [] })).toThrow(
      /empty member set/,
    );
  });

  it('throws on an empty member set for an array column', () => {
    expect(() =>
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'roles',
        many: true,
        memberValues: [],
      }),
    ).toThrow(/empty member set/);
  });

  it('quotes identifiers and escapes literal quotes', () => {
    expect(
      postgresRenderCheckExpressions({
        tableName: 'Order',
        columnName: 'sta"tus',
        many: false,
        memberValues: ["o'brien"],
      }),
    ).toEqual([
      { kind: 'membership', columnName: 'sta"tus', expression: `"sta""tus" IN ('o''brien')` },
    ]);
  });
});
