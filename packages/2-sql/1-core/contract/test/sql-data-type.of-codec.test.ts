import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { sqlDataTypeOfCodec } from '../src/sql-data-type';
import { enumType, int4, numeric, vector } from './sql-data-type-fixtures';

const plain = dataType('t/plain', {});

describe('sqlDataTypeOfCodec', () => {
  const dataTypeLookup = createDataTypeLookup([int4, numeric, vector, enumType, plain]);
  const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
    descriptorFor: (id) =>
      ({
        't/int4@1': { codecId: id, dataType: int4.id },
        't/numeric@1': { codecId: id, dataType: numeric.id },
        't/vector@1': { codecId: id, dataType: vector.id },
        't/enum@1': { codecId: id, dataType: enumType.id },
        't/plain@1': { codecId: id, dataType: plain.id },
        't/orphan@1': { codecId: id, dataType: 't/gone' },
      })[id] as never,
  };
  const lookups = { codecLookup, dataTypeLookup };

  it('is the data type the codec represents', () => {
    expect(sqlDataTypeOfCodec('t/int4@1', lookups)).toBe(int4);
  });

  it('refuses a codec the stack does not register', () => {
    expect(() => sqlDataTypeOfCodec('t/unknown@1', lookups)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
        meta: { codecId: 't/unknown@1' },
        fix: expect.stringContaining('pack that provides the codec'),
      }),
    );
  });

  it('refuses a codec whose data type the stack does not register', () => {
    expect(() => sqlDataTypeOfCodec('t/orphan@1', lookups)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
        meta: { codecId: 't/orphan@1', dataType: 't/gone' },
        fix: expect.stringContaining('pack that provides the codec'),
      }),
    );
  });

  it('refuses a data type that is not a SQL data type', () => {
    expect(() => sqlDataTypeOfCodec('t/plain@1', lookups)).toThrow(InternalError);
  });
});
