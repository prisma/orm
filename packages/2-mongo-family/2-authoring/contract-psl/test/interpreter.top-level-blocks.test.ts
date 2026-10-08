import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { emptyCodecLookup } from '@internal/framework-components/codec';
import { EMPTY_DATA_TYPES } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

function diagnosticsOf(schema: string): readonly ContractSourceDiagnostic[] {
  const result = interpretMongoContract(schema, {
    scalarTypeCodecIds: new Map([['ObjectId', 'mongo/objectId@1']]),
    codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
    dataTypes: EMPTY_DATA_TYPES,
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
  });
  if (result.ok) throw new Error('Expected interpretation to fail');
  return result.failure.diagnostics;
}

const model = `model User {
  id ObjectId @id @map("_id")
}
`;

describe('Mongo PSL top-level blocks', () => {
  it.each([
    ['view', 'view Stats {\n  id ObjectId @id @map("_id")\n}\n'],
    ['datasource', 'datasource db {\n  provider = "mongodb"\n}\n'],
    ['generator', 'generator client {\n  provider = "prisma-client"\n}\n'],
  ])('reports a %s block as PSL_UNSUPPORTED_TOP_LEVEL_BLOCK at its keyword', (keyword, block) => {
    expect(diagnosticsOf(`${block}\n${model}`)).toEqual([
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
  });
});
