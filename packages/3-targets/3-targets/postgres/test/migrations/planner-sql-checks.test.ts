import { toStorageTypeInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildExpectedFormatType,
  qualifyTableName,
} from '../../src/core/migrations/planner-sql-checks';

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });

  it('elides the qualifier for the unbound schema sentinel', () => {
    expect(qualifyTableName('__unbound__', 'post')).toBe('"post"');
  });
});

describe('buildExpectedFormatType', () => {
  const noHooks = new Map();

  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int2', codecId: 'pg/int2@1', nullable: false },
          noHooks,
        ),
      ).toBe('smallint');
    });

    it('maps timestamptz to timestamp with time zone', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'timestamptz', codecId: 'pg/timestamptz-temporal@1', nullable: false },
          noHooks,
        ),
      ).toBe('timestamp with time zone');
    });
  });

  describe('unmapped native types pass through', () => {
    it('returns nativeType as-is for text', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          noHooks,
        ),
      ).toBe('text');
    });
  });

  describe('user-defined types (typeRef path)', () => {
    it('returns simple lowercase UDT name unquoted', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'my_status', codecId: 'app/udt@1', nullable: false, typeRef: 'MyStatus' },
          noHooks,
        ),
      ).toBe('my_status');
    });

    it('quotes reserved word used as UDT name', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'user', codecId: 'app/udt@1', nullable: false, typeRef: 'User' },
          noHooks,
        ),
      ).toBe('"user"');
    });

    it('quotes mixed-case identifier', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'OrderStatus',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"OrderStatus"');
    });
  });

  describe('codec hook expansion', () => {
    it('delegates to expandNativeType when typeParams and codec hook exist', () => {
      const hooks = new Map([
        [
          'pg/decimal@1',
          {
            expandNativeType: ({
              nativeType,
              typeParams,
            }: {
              nativeType: string;
              typeParams?: Record<string, unknown>;
            }) => `${nativeType}(${typeParams?.['precision']},${typeParams?.['scale']})`,
          },
        ],
      ]);
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'numeric',
            codecId: 'pg/decimal@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          hooks,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when typeParams present but no matching hook entry', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          noHooks,
        ),
      ).toBe('integer');
    });

    it('falls back to display map when the matching hook has no expandNativeType', () => {
      const hooks = new Map([['pg/int4@1', {}]]);
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          hooks,
        ),
      ).toBe('integer');
    });

    it('falls back to display map when typeParams is present but codecId is missing', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'int4',
            codecId: '',
            nullable: false,
            typeParams: { someParam: true },
          },
          noHooks,
        ),
      ).toBe('integer');
    });
  });

  describe('typeRef resolution against a storage type catalog', () => {
    it('resolves nativeType/codecId from the referenced storage type, then formats as a UDT name (typeRef wins over the display map)', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'unused', codecId: 'unused', nullable: false, typeRef: 'MyStatus' },
          noHooks,
          { MyStatus: toStorageTypeInstance({ codecId: 'pg/int4@1', nativeType: 'int4' }) },
        ),
      ).toBe('int4');
    });
  });
});
