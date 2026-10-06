import { toStorageTypeInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildExpectedFormatType,
  qualifyTableName,
} from '../../src/core/migrations/planner-sql-checks';
import { postgresTypeLookups as types } from '../postgres-type-lookups';

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });

  it('elides the qualifier for the unbound schema sentinel', () => {
    expect(qualifyTableName('__unbound__', 'post')).toBe('"post"');
  });
});

describe('buildExpectedFormatType', () => {
  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'int2', codecId: 'pg/int2@1', nullable: false },
          types,
        ),
      ).toBe('smallint');
    });

    it('maps timestamptz to timestamp with time zone', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'timestamptz',
            codecId: 'pg/timestamptz-temporal@1',
            nullable: false,
          },
          types,
        ),
      ).toBe('timestamp with time zone');
    });
  });

  it('names a fixed-length type without a length as format_type does, with a length of 1', () => {
    expect([
      buildExpectedFormatType(
        { many: false, nativeType: 'character', codecId: 'sql/char@1', nullable: false },
        types,
      ),
      buildExpectedFormatType(
        { many: false, nativeType: 'bit', codecId: 'pg/bit@1', nullable: false },
        types,
      ),
    ]).toEqual(['character(1)', 'bit(1)']);
  });

  it('names a type written under another PostgreSQL name as format_type does', () => {
    expect(
      [
        { nativeType: 'char', codecId: 'sql/char@1' },
        { nativeType: 'varchar', codecId: 'sql/varchar@1' },
        { nativeType: 'int', codecId: 'sql/int@1' },
        { nativeType: 'float', codecId: 'sql/float@1' },
      ].map((column) =>
        buildExpectedFormatType({ ...column, many: false, nullable: false }, types),
      ),
    ).toEqual(['character(1)', 'character varying', 'integer', 'double precision']);
  });

  it('names a type with type parameters as format_type does', () => {
    expect(
      [
        { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 6 } },
        { codecId: 'pg/time-temporal@1', typeParams: { precision: 0 } },
        { codecId: 'pg/timetz@1', typeParams: { precision: 2 } },
        { codecId: 'pg/numeric@1', typeParams: { precision: 10 } },
      ].map((column) =>
        buildExpectedFormatType(
          { ...column, many: false, nativeType: 'unused', nullable: false },
          types,
        ),
      ),
    ).toEqual([
      'timestamp(3) with time zone',
      'timestamp(6) without time zone',
      'time(0) without time zone',
      'time(2) with time zone',
      'numeric(10,0)',
    ]);
  });

  describe('unmapped native types pass through', () => {
    it('returns nativeType as-is for text', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          types,
        ),
      ).toBe('text');
    });
  });

  describe('parameterized data types', () => {
    it('renders the data type with its parameters', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'numeric',
            codecId: 'pg/numeric@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          types,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when typeParams are ones the data type does not declare', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          types,
        ),
      ).toBe('integer');
    });

    it('throws CONTRACT.CODEC_DESCRIPTOR_MISSING when codecId is missing', () => {
      expect(() =>
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'int4',
            codecId: '',
            nullable: false,
            typeParams: { someParam: true },
          },
          types,
        ),
      ).toThrow(expect.objectContaining({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' }));
    });
  });

  describe('typeRef resolution against a storage type catalog', () => {
    it('resolves nativeType/codecId from the referenced storage type, then applies the display map', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'unused',
            codecId: 'unused',
            nullable: false,
            typeRef: 'MyStatus',
          },
          types,
          { MyStatus: toStorageTypeInstance({ codecId: 'pg/int4@1', nativeType: 'int4' }) },
        ),
      ).toBe('integer');
    });
  });
});
