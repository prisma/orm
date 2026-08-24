import { describe, expect, it } from 'vitest';
import type { AnyCodecDescriptor } from '../../src/ast/codec-types';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../../src/ast/sql-codec-helpers';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '../../src/ast/sql-codecs';

const descriptorsByScalar = {
  char: sqlCharDescriptor,
  varchar: sqlVarcharDescriptor,
  int: sqlIntDescriptor,
  float: sqlFloatDescriptor,
  text: sqlTextDescriptor,
} as const satisfies Record<string, AnyCodecDescriptor>;

describe('sql-codec-helpers', () => {
  it('exports expected codec IDs', () => {
    expect({
      char: SQL_CHAR_CODEC_ID,
      varchar: SQL_VARCHAR_CODEC_ID,
      int: SQL_INT_CODEC_ID,
      float: SQL_FLOAT_CODEC_ID,
      text: SQL_TEXT_CODEC_ID,
    }).toEqual({
      char: 'sql/char@1',
      varchar: 'sql/varchar@1',
      int: 'sql/int@1',
      float: 'sql/float@1',
      text: 'sql/text@1',
    });
  });

  const codecDefinitionCases: ReadonlyArray<{
    scalar: keyof typeof descriptorsByScalar;
    id: string;
    targetTypes: readonly string[];
    hasParamsSchema: boolean;
  }> = [
    { scalar: 'char', id: SQL_CHAR_CODEC_ID, targetTypes: ['char'], hasParamsSchema: true },
    {
      scalar: 'varchar',
      id: SQL_VARCHAR_CODEC_ID,
      targetTypes: ['varchar'],
      hasParamsSchema: true,
    },
    { scalar: 'int', id: SQL_INT_CODEC_ID, targetTypes: ['int'], hasParamsSchema: true },
    { scalar: 'float', id: SQL_FLOAT_CODEC_ID, targetTypes: ['float'], hasParamsSchema: true },
    { scalar: 'text', id: SQL_TEXT_CODEC_ID, targetTypes: ['text'], hasParamsSchema: true },
  ];

  it.each(codecDefinitionCases)(
    'defines descriptor for $scalar',
    ({ scalar, id, targetTypes, hasParamsSchema }) => {
      const descriptor = descriptorsByScalar[scalar];
      expect(descriptor.codecId).toBe(id);
      expect(descriptor.targetTypes).toEqual(targetTypes);
      expect(descriptor.paramsSchema !== undefined).toBe(hasParamsSchema);
    },
  );

  const codecRoundTripCases: ReadonlyArray<{
    scalar: keyof typeof descriptorsByScalar;
    input: string | number;
    expectedEncoded: string | number;
    expectedDecoded: string | number;
  }> = [
    { scalar: 'char', input: 'A', expectedEncoded: 'A', expectedDecoded: 'A' },
    { scalar: 'varchar', input: 'hello', expectedEncoded: 'hello', expectedDecoded: 'hello' },
    { scalar: 'int', input: 42, expectedEncoded: 42, expectedDecoded: 42 },
    { scalar: 'float', input: 3.14, expectedEncoded: 3.14, expectedDecoded: 3.14 },
    {
      scalar: 'text',
      input: 'portable text',
      expectedEncoded: 'portable text',
      expectedDecoded: 'portable text',
    },
  ];

  it.each(codecRoundTripCases)(
    'encodes and decodes $scalar values',
    async ({ scalar, input, expectedEncoded, expectedDecoded }) => {
      const descriptor = descriptorsByScalar[scalar] as AnyCodecDescriptor;
      const codec = descriptor.factory(undefined as never)({ name: 'test' });
      expect(await codec.encode(input, {})).toBe(expectedEncoded);
      expect(await codec.decode(input, {})).toBe(expectedDecoded);
    },
  );

  it('trims trailing spaces when decoding char values', async () => {
    const codec = sqlCharDescriptor.factory({})({ name: 'test' });
    expect(await codec.decode('user_001                            ', {})).toBe('user_001');
    expect(await codec.decode('user_001', {})).toBe('user_001');
  });

  describe('renderOutputType', () => {
    it('sql/char@1 renders Char<length>', () => {
      expect(sqlCharDescriptor.renderOutputType?.({ length: 36 })).toBe('Char<36>');
    });

    it('sql/char@1 returns undefined when length absent', () => {
      expect(sqlCharDescriptor.renderOutputType?.({})).toBeUndefined();
    });

    it('sql/char@1 throws on invalid length type', () => {
      expect(() =>
        sqlCharDescriptor.renderOutputType?.({ length: 'bad' as unknown as number }),
      ).toThrow(/expected integer "length"/);
    });

    it('sql/varchar@1 renders Varchar<length>', () => {
      expect(sqlVarcharDescriptor.renderOutputType?.({ length: 255 })).toBe('Varchar<255>');
    });

    it('sql/varchar@1 returns undefined when length absent', () => {
      expect(sqlVarcharDescriptor.renderOutputType?.({})).toBeUndefined();
    });

    it('sql/varchar@1 throws on invalid length type', () => {
      expect(() =>
        sqlVarcharDescriptor.renderOutputType?.({ length: 'bad' as unknown as number }),
      ).toThrow(/expected integer "length"/);
    });

    it('sql/int@1 has no renderOutputType', () => {
      expect(sqlIntDescriptor.renderOutputType).toBeUndefined();
    });

    it('sql/float@1 has no renderOutputType', () => {
      expect(sqlFloatDescriptor.renderOutputType).toBeUndefined();
    });

    it('sql/text@1 has no renderOutputType', () => {
      expect(sqlTextDescriptor.renderOutputType).toBeUndefined();
    });
  });
});
