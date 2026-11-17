import { describe, expect, it } from 'vitest';
import type { AnyCodecDescriptorTemplate } from '../../src/ast/codec-types';
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
} as const satisfies Record<string, AnyCodecDescriptorTemplate>;

describe('sql-codec-helpers', () => {
  const codecDefinitionCases: ReadonlyArray<{
    scalar: keyof typeof descriptorsByScalar;
    id: string;
    hasParamsSchema: boolean;
  }> = [
    { scalar: 'char', id: SQL_CHAR_CODEC_ID, hasParamsSchema: false },
    { scalar: 'varchar', id: SQL_VARCHAR_CODEC_ID, hasParamsSchema: false },
    { scalar: 'int', id: SQL_INT_CODEC_ID, hasParamsSchema: false },
    { scalar: 'float', id: SQL_FLOAT_CODEC_ID, hasParamsSchema: false },
    { scalar: 'text', id: SQL_TEXT_CODEC_ID, hasParamsSchema: false },
  ];

  it.each(codecDefinitionCases)(
    'defines descriptor for $scalar, with no parameter bound of its own',
    ({ scalar, id, hasParamsSchema }) => {
      const descriptor = descriptorsByScalar[scalar];
      expect(descriptor.codecId).toBe(id);
      expect(descriptor.paramsSchema !== undefined).toBe(hasParamsSchema);
    },
  );

  describe('renderOutputType', () => {
    it('sql/char@1 and sql/varchar@1 have none; their pack declares their output types', () => {
      expect(sqlCharDescriptor.renderOutputType).toBeUndefined();
      expect(sqlVarcharDescriptor.renderOutputType).toBeUndefined();
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
