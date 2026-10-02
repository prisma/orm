import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
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
  const types: SqlTypeLookups = {
    codecLookup: postgresCodecDescriptorRegistry,
    dataTypeLookup: createDataTypeLookup(postgresDataTypes),
  };

  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/int2@1' }, types)).toBe('smallint');
    });

    it('maps int4 to integer', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/int4@1' }, types)).toBe('integer');
    });

    it('maps int8 to bigint', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/int8@1' }, types)).toBe('bigint');
    });

    it('maps float4 to real', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/float4@1' }, types)).toBe('real');
    });

    it('maps float8 to double precision', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/float8@1' }, types)).toBe('double precision');
    });

    it('maps bool to boolean', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/bool@1' }, types)).toBe('boolean');
    });
  });

  describe('unmapped native types pass through', () => {
    it('returns the type name as-is for text', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/text@1' }, types)).toBe('text');
    });

    it('returns the type name as-is for uuid', () => {
      expect(buildExpectedFormatType({ codecId: 'pg/uuid@1' }, types)).toBe('uuid');
    });
  });

  describe('parameterized data types', () => {
    it('writes the data type with its parameters', () => {
      expect(
        buildExpectedFormatType(
          { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          types,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when the data type declares none of the typeParams', () => {
      expect(
        buildExpectedFormatType({ codecId: 'pg/int4@1', typeParams: { someParam: true } }, types),
      ).toBe('integer');
    });
  });
});
