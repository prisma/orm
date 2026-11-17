import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { unquotedSqlBaseName, unquotedSqlBaseNameOfCodec } from '../src/sql-data-type';
import { enumType, geometry, int4, numeric, textArray, vector } from './sql-data-type-fixtures';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

describe('unquotedSqlBaseName', () => {
  it('is the base name for a type written by name', () => {
    expect(unquotedSqlBaseName(int4, {})).toBe('int4');
    expect(unquotedSqlBaseName(numeric, { precision: 10, scale: 2 })).toBe('numeric');
    expect(unquotedSqlBaseName(vector, { length: 3 })).toBe('vector');
    expect(unquotedSqlBaseName(vector, {})).toBe('vector');
    expect(unquotedSqlBaseName(geometry, { srid: 4326 })).toBe('geometry');
  });

  it('is the unquoted typeName for a type that claims a kind', () => {
    expect(unquotedSqlBaseName(enumType, { typeName: 'app.status' })).toBe('app.status');
    expect(unquotedSqlBaseName(enumType, { typeName: 'Mood' })).toBe('Mood');
  });

  it('refuses a kind-claiming type without a typeName', () => {
    expect(() => unquotedSqlBaseName(enumType, {})).toThrow(invalidParams);
  });

  it('does not exist for a type that is never written', () => {
    expect(() => unquotedSqlBaseName(textArray, {})).toThrow(InternalError);
  });
});

describe('unquotedSqlBaseNameOfCodec', () => {
  const dataTypeLookup = createDataTypeLookup([int4, enumType]);
  const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
    descriptorFor: (id) =>
      ({
        't/int4@1': { codecId: id, dataType: int4.id },
        't/enum@1': { codecId: id, dataType: enumType.id },
        't/orphan@1': { codecId: id, dataType: 't/gone' },
      })[id] as never,
  };
  const lookups = { codecLookup, dataTypeLookup };

  it('ignores codec parameters the data type does not declare', () => {
    expect(unquotedSqlBaseNameOfCodec('t/int4@1', { expression: 'x' }, lookups)).toBe('int4');
  });

  it('names the type of the codec’s data type', () => {
    expect(unquotedSqlBaseNameOfCodec('t/int4@1', undefined, lookups)).toBe('int4');
    expect(unquotedSqlBaseNameOfCodec('t/enum@1', { typeName: 'Mood' }, lookups)).toBe('Mood');
  });

  it('refuses a codec the stack does not register', () => {
    expect(() => unquotedSqlBaseNameOfCodec('t/unknown@1', undefined, lookups)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' }),
    );
  });

  it('refuses a codec whose data type the stack does not register', () => {
    expect(() => unquotedSqlBaseNameOfCodec('t/orphan@1', undefined, lookups)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.DATA_TYPE_UNREGISTERED' }),
    );
  });
});
