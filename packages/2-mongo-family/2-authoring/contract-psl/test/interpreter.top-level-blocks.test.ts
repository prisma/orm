import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

function diagnosticsOf(schema: string): readonly ContractSourceDiagnostic[] {
  const result = interpretMongoContract(schema, {
    scalarTypes: new Map([['ObjectId', 'mongo/objectId@1']]),
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
    defaultFunctionRegistry: new Map(),
  });
  if (result.ok) throw new Error('Expected interpretation to fail');
  return result.failure.diagnostics;
}

const model = `model User {
  id ObjectId @id @map("_id")
}
`;

const parserRefusal = expect.objectContaining({
  code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
  message: 'Invalid block entry',
});

describe('Mongo PSL top-level blocks', () => {
  it.each([
    ['view', 'view Stats {\n  id ObjectId @id @map("_id")\n}\n', [parserRefusal]],
    ['datasource', 'datasource db {\n  provider = "mongodb"\n}\n', []],
    ['generator', 'generator client {\n  provider = "prisma-client"\n}\n', []],
  ])(
    'reports a %s block as PSL_UNSUPPORTED_TOP_LEVEL_BLOCK at its keyword',
    (keyword, block, parser) => {
      expect(diagnosticsOf(`${block}\n${model}`)).toEqual([
        ...parser,
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          message: `Unsupported top-level block "${keyword}"`,
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 1, column: 1 }),
            end: expect.objectContaining({ line: 1, column: keyword.length + 1 }),
          }),
        }),
      ]);
    },
  );
});
