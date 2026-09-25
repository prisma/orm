import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['Int32', 'mongo/int32@1'],
  ['Double', 'mongo/double@1'],
  ['Bool', 'mongo/bool@1'],
  ['Date', 'mongo/date@1'],
]);

function diagnosticsOf(schema: string): readonly ContractSourceDiagnostic[] {
  const { document, sources } = parse(schema, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const result = interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds,
    controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
  });
  if (result.ok) throw new Error('Expected interpretation to fail');
  return result.failure.diagnostics;
}

describe('Mongo PSL scalar names renamed to the target names', () => {
  it.each([
    ['Int', 'Int32', 'int'],
    ['Float', 'Double', 'double'],
    ['Boolean', 'Bool', 'bool'],
    ['DateTime', 'Date', 'date'],
  ])('reports %s with the name to use instead, at the type', (oldName, newName, bsonType) => {
    const schema = `model Post {\n  id ObjectId @id @map("_id")\n  value ${oldName}?\n}\n`;
    expect(diagnosticsOf(schema)).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: `Scalar type "${oldName}" was renamed to "${newName}" (stored as BSON ${bsonType}). Replace "${oldName}" with "${newName}".`,
        sourceId: 'schema.prisma',
        span: expect.objectContaining({
          start: expect.objectContaining({ line: 3, column: 9 }),
          end: expect.objectContaining({ line: 3, column: 9 + oldName.length }),
        }),
      },
    ]);
  });

  it('gives no rename hint for a type that was never a Mongo scalar', () => {
    const schema = 'model Post {\n  id ObjectId @id @map("_id")\n  value Money\n}\n';
    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: 'Field "Post.value" type "Money" is not supported in Mongo PSL interpreter',
      }),
    ]);
  });
});
