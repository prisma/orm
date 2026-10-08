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
