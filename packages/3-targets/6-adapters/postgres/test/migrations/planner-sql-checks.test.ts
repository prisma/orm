import {
  buildExpectedFormatType,
  qualifyTableName,
} from '@internal/target-postgres/planner-sql-checks';
import { describe, expect, it } from 'vitest';

// Raw-string check helpers (columnExistsCheck, columnNullabilityCheck,
// columnTypeCheck, columnDefaultExistsCheck, columnHasNoDefaultCheck,
// tableHasPrimaryKeyCheck, tableIsEmptyCheck, toRegclassLiteral) were replaced
// by typed AST builders (columnExistsAst, columnNullabilityAst, etc.) from
// @internal/target-postgres/contract-free. Construction pins live in
// target-postgres test/migrations/verification-checks.test.ts and lowering
// pins in test/verification-checks-lowering.test.ts.

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });
});

describe('buildExpectedFormatType', () => {
  const noHooks = new Map();

  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'int2', codecId: 'pg/int2@1', nullable: false },
          noHooks,
        ),
      ).toBe('smallint');
    });

    it('maps int4 to integer', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          noHooks,
        ),
      ).toBe('integer');
    });

    it('maps int8 to bigint', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
          noHooks,
        ),
      ).toBe('bigint');
    });

    it('maps float4 to real', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'float4', codecId: 'pg/float4@1', nullable: false },
          noHooks,
        ),
      ).toBe('real');
    });

    it('maps float8 to double precision', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'float8', codecId: 'pg/float8@1', nullable: false },
          noHooks,
        ),
      ).toBe('double precision');
    });

    it('maps bool to boolean', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'bool', codecId: 'pg/bool@1', nullable: false },
          noHooks,
        ),
      ).toBe('boolean');
    });
  });

  describe('unmapped native types pass through', () => {
    it('returns nativeType as-is for text', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          noHooks,
        ),
      ).toBe('text');
    });

    it('returns nativeType as-is for uuid', () => {
      expect(
        buildExpectedFormatType(
          { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          noHooks,
        ),
      ).toBe('uuid');
    });
  });

  describe('user-defined types (typeRef path)', () => {
    it('returns simple lowercase UDT name unquoted', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'my_status',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'MyStatus',
          },
          noHooks,
        ),
      ).toBe('my_status');
    });

    it('quotes reserved word used as UDT name', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'user',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'User',
          },
          noHooks,
        ),
      ).toBe('"user"');
    });

    it('quotes another reserved word (select)', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'select',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'Select',
          },
          noHooks,
        ),
      ).toBe('"select"');
    });

    it('quotes mixed-case identifier', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'OrderStatus',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"OrderStatus"');
    });

    it('quotes identifier with hyphens', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'order-status',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order-status"');
    });

    it('quotes identifier with spaces', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'order status',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order status"');
    });

    it('quotes identifier starting with digit', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: '2fa_type',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'TwoFaType',
          },
          noHooks,
        ),
      ).toBe('"2fa_type"');
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
            many: false,
            nativeType: 'numeric',
            codecId: 'pg/decimal@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          hooks,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when typeParams present but no hook', () => {
      expect(
        buildExpectedFormatType(
          {
            many: false,
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          noHooks,
        ),
      ).toBe('integer');
    });
  });
});
