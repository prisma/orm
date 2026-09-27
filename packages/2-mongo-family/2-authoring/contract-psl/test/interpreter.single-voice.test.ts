import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import type { DocumentAst, PslSources } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

function symbolTableInput(schema: string): {
  documents: readonly DocumentAst[];
  symbolTable: SymbolTable;
  sources: PslSources;
} {
  const { document, sources } = parse(schema, 'test.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return { documents: [document], symbolTable, sources };
}

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
  ['ObjectId', 'mongo/objectId@1'],
]);

function diagnosticCodes(schema: string): readonly string[] {
  const result = interpretPslDocumentToMongoContract({
    ...symbolTableInput(schema),
    scalarTypeCodecIds,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      dataTypeEntries: {},
    },
  });
  if (result.ok) throw new Error('expected interpretation to fail');
  return result.failure.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('one voice per resolution failure', () => {
  it('reports an unknown model attribute only as unsupported', () => {
    expect(diagnosticCodes('model Item {\n  id ObjectId @id @map("_id")\n  @@mystery\n}')).toEqual([
      'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
    ]);
  });

  it('reports a missing @@base target only as an unresolved reference', () => {
    expect(
      diagnosticCodes('model Bug {\n  id ObjectId @id @map("_id")\n  @@base(NoSuch, "bug")\n}'),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });

  it('reports an unknown @@index field only as an unresolved reference', () => {
    expect(
      diagnosticCodes('model Item {\n  id ObjectId @id @map("_id")\n  @@index([nope])\n}'),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });

  it('keeps the orphaned-backrelation verdict beside an unresolved relation field', () => {
    expect(
      diagnosticCodes(
        [
          'model User {',
          '  id ObjectId @id @map("_id")',
          '}',
          'model Post {',
          '  id ObjectId @id @map("_id")',
          '  authorId ObjectId',
          '  author User @relation(fields: [missing], references: [id])',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE', 'PSL_ORPHANED_BACKRELATION']);
  });

  it('keeps the orphaned-base verdict beside an unresolved discriminator field', () => {
    expect(
      diagnosticCodes(
        [
          'model Base {',
          '  id ObjectId @id @map("_id")',
          '  @@discriminator(nope)',
          '}',
          'model Child {',
          '  id ObjectId @id @map("_id")',
          '  @@base(Base, "c")',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE', 'PSL_ORPHANED_BASE']);
  });
});
