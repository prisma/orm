import type { DataType } from '@internal/framework-components/codec';
import { SqlColumnIR, type SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { pgInt4, pgInt8, pgNumeric, pgText, pgVarchar } from '../../src/core/data-types';
import { liveColumnWidensSafely } from '../../src/core/migrations/safe-widenings';

const column = (input: Partial<SqlColumnIRInput>) =>
  new SqlColumnIR({ name: 'c', typeText: '', nullable: false, ...input });

describe('liveColumnWidensSafely', () => {
  it('compares the type each column is stored as and its parameters in normal form', () => {
    const stored = (storedType: DataType, storedTypeParams = {}) =>
      column({ storedType, storedTypeParams });
    expect({
      int4ToInt8: liveColumnWidensSafely(stored(pgInt8), stored(pgInt4)),
      int8ToInt4: liveColumnWidensSafely(stored(pgInt4), stored(pgInt8)),
      varcharToText: liveColumnWidensSafely(stored(pgText), stored(pgVarchar, { length: 10 })),
      longerVarchar: liveColumnWidensSafely(
        stored(pgVarchar, { length: 20 }),
        stored(pgVarchar, { length: 10 }),
      ),
      moreScale: liveColumnWidensSafely(
        stored(pgNumeric, { precision: 12, scale: 4 }),
        stored(pgNumeric, { precision: 10, scale: 2 }),
      ),
      lessScale: liveColumnWidensSafely(
        stored(pgNumeric, { precision: 10, scale: 3 }),
        stored(pgNumeric, { precision: 10, scale: 2 }),
      ),
    }).toEqual({
      int4ToInt8: true,
      int8ToInt4: false,
      varcharToText: true,
      longerVarchar: true,
      moreScale: true,
      lessScale: false,
    });
  });

  it('is false when either column has no stored type, or either is a list', () => {
    const int4 = column({ storedType: pgInt4, storedTypeParams: {} });
    const int8 = column({ storedType: pgInt8, storedTypeParams: {} });
    expect([
      liveColumnWidensSafely(int8, column({})),
      liveColumnWidensSafely(column({}), int4),
      liveColumnWidensSafely(
        int8,
        column({ storedType: pgInt4, storedTypeParams: {}, many: true }),
      ),
    ]).toEqual([false, false, false]);
  });
});
