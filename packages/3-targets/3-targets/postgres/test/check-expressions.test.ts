import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';

const base = {
  tableName: 'User',
  columnName: 'role',
  many: false,
  memberValues: undefined,
};

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

  it('compares numeric array members in the column type', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        many: { elementNullable: false },
        memberValues: [1, 2.5, -3],
      }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'role',
        expression: `array_remove("role", NULL) <@ '{1,2.5,-3}'`,
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
      for (const many of [false, { elementNullable: false }] as const) {
        expect(() =>
          postgresRenderCheckExpressions({ ...base, many, memberValues: [1, value] }),
        ).toThrow(/non-finite numeric member/);
      }
    },
  );

  it('renders array membership over null-stripped elements', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'roles',
        many: { elementNullable: false },
        memberValues: ['user', 'admin'],
      }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'roles',
        expression: `array_remove("roles", NULL) <@ '{"user","admin"}'`,
      },
      {
        kind: 'elementNotNull',
        columnName: 'roles',
        expression: `array_position("roles", NULL) IS NULL`,
      },
    ]);
  });

  it('renders element-non-null only for a list column with no member set', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'tags',
        many: { elementNullable: false },
      }),
    ).toEqual([
      {
        kind: 'elementNotNull',
        columnName: 'tags',
        expression: `array_position("tags", NULL) IS NULL`,
      },
    ]);
  });

  it('omits element-non-null for a nullable-element list while preserving membership', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'roles',
        many: { elementNullable: true },
        memberValues: ['user', 'admin'],
      }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'roles',
        expression: `array_remove("roles", NULL) <@ '{"user","admin"}'`,
      },
    ]);
  });

  it('escapes array-literal and SQL quoting in list members', () => {
    expect(
      postgresRenderCheckExpressions({
        ...base,
        columnName: 'roles',
        many: { elementNullable: true },
        memberValues: ['say "hi"', 'back\\slash', "o'brien", '', 'NULL'],
      }),
    ).toEqual([
      {
        kind: 'membership',
        columnName: 'roles',
        expression: `array_remove("roles", NULL) <@ '{"say \\"hi\\"","back\\\\slash","o''brien","","NULL"}'`,
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
        many: { elementNullable: false },
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
