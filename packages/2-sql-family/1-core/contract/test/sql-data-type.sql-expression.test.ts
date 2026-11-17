import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import {
  findSqlDataTypeCollision,
  isSqlDataType,
  sqlDataType,
  sqlDataTypeOfCodec,
} from '../src/sql-data-type';
import { SQL_EXPRESSION_DATA_TYPE_ID, sqlExpressionDataType } from '../src/sql-expression';

const text = sqlDataType('t/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true, catalog: true }],
});

describe("the SQL family's sql/expression data type", () => {
  it('is not a SQL data type, so it has no texts', () => {
    expect(isSqlDataType(sqlExpressionDataType)).toBe(false);
  });

  it('takes no part in the collision check', () => {
    expect(findSqlDataTypeCollision([sqlExpressionDataType, text])).toBeUndefined();
  });

  it('cannot name a column type through a codec', () => {
    const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
      descriptorFor: (id) =>
        id === 't/expression@1'
          ? ({ codecId: id, dataType: SQL_EXPRESSION_DATA_TYPE_ID } as never)
          : undefined,
    };
    const lookups = {
      codecLookup,
      dataTypeLookup: createDataTypeLookup([sqlExpressionDataType, text]),
    };
    expect(() => sqlDataTypeOfCodec('t/expression@1', lookups)).toThrow(InternalError);
  });
});

describe('a stored sql/expression value', () => {
  it('is the canonical text of a sql literal', () => {
    const value = sqlExpressionDataType.fromContract('now()', {});

    expect(sqlExpressionDataType.toContract(value)).toBe('now()');
  });

  it('refuses text a sql literal canonicalizes, naming the canonical text', () => {
    expect(() => sqlExpressionDataType.fromContract('\n    now()\n  ', {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'sql/expression JSON value must be "now()", the canonical text of the sql literal it was written as',
        meta: { dataType: 'sql/expression', received: JSON.stringify('\n    now()\n  ') },
      }),
    );
  });

  it('refuses text no sql literal can hold', () => {
    expect(() => sqlExpressionDataType.fromContract('a\0b', {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'sql/expression JSON value must be text a sql literal can hold',
        meta: { dataType: 'sql/expression', received: JSON.stringify('a\0b') },
      }),
    );
  });

  it('refuses a value that is not text', () => {
    expect(() => sqlExpressionDataType.fromContract(1, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'sql/expression JSON value must be a string',
      }),
    );
  });
});
