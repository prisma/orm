import type { StorageColumn } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { renderDefaultLiteral } from '../../src/core/migrations/planner-ddl-builders';

function arrayColumn(nativeType: string): StorageColumn {
  return {
    nativeType,
    codecId: 'pg/text@1',
    nullable: false,
    many: true,
  } as StorageColumn;
}

describe('renderDefaultLiteral array columns', () => {
  it('renders an empty array default as the empty array literal', () => {
    expect(renderDefaultLiteral([], arrayColumn('text[]'))).toBe("'{}'");
  });

  it('renders a string array default as an ARRAY[...] expression cast to the column type', () => {
    expect(renderDefaultLiteral(['a', 'b'], arrayColumn('text[]'))).toBe("ARRAY['a', 'b']::text[]");
  });

  it('renders Date array elements as ISO timestamp literals, not JSON blobs', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(renderDefaultLiteral([d], arrayColumn('timestamptz[]'))).toBe(
      "ARRAY['2026-01-02T03:04:05.000Z']::timestamptz[]",
    );
  });

  it.each([
    {
      value: ['1', '-2', '9007199254740993'],
      nativeType: 'int8',
      sql: "ARRAY['1', '-2', '9007199254740993']::int8[]",
    },
    {
      value: ['1.5', '-2.25'],
      nativeType: 'numeric(65,30)',
      sql: "ARRAY['1.5', '-2.25']::numeric(65,30)[]",
    },
    { value: ['1.50'], nativeType: 'numeric', sql: "ARRAY['1.50']::numeric[]" },
    {
      value: ['2024-01-01T00:00:00'],
      nativeType: 'timestamp(3)',
      sql: "ARRAY['2024-01-01T00:00:00']::timestamp(3)[]",
    },
  ])(
    'casts the text elements of a $nativeType list to the list type',
    ({ value, nativeType, sql }) => {
      expect(renderDefaultLiteral(value, arrayColumn(nativeType))).toBe(sql);
      expect(renderDefaultLiteral(value, arrayColumn(`${nativeType}[]`))).toBe(sql);
    },
  );

  it.each([
    { nativeType: 'audit.AuditAction[]', cast: '"audit"."AuditAction"[]' },
    { nativeType: 'AuditAction', cast: '"AuditAction"[]' },
    { nativeType: 'auth.oauth_client_type', cast: '"auth"."oauth_client_type"[]' },
    { nativeType: 'user_role', cast: 'user_role[]' },
    { nativeType: '"audit"."AuditAction"[]', cast: '"audit"."AuditAction"[]' },
    { nativeType: 'character varying(32)', cast: 'character varying(32)[]' },
  ])('casts a $nativeType list to $cast', ({ nativeType, cast }) => {
    expect(renderDefaultLiteral(['CREATE'], arrayColumn(nativeType))).toBe(
      `ARRAY['CREATE']::${cast}`,
    );
  });

  it('renders an ARRAY[...] expression without a cast when no native type is known', () => {
    expect(renderDefaultLiteral(['a'], arrayColumn(''))).toBe("ARRAY['a']");
  });

  it('renders a null literal default on a many column as NULL', () => {
    expect(renderDefaultLiteral(null, arrayColumn('text[]'))).toBe('NULL');
  });
});
