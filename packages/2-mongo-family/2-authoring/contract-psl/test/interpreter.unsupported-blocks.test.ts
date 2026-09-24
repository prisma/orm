import { emptyCodecLookup } from '@internal/framework-components/codec';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

function interpret(schema: string) {
  const { document, sources } = parse(schema, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds: new Map([
      ['String', 'mongo/string@1'],
      ['ObjectId', 'mongo/objectId@1'],
    ]),
    controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
    codecLookup: emptyCodecLookup,
  });
}

const userModel = 'model User {\n  id ObjectId @id @map("_id")\n}\n';

describe('interpretPslDocumentToMongoContract given a block no composed descriptor claims', () => {
  it.each([
    ['plain fields', 'view ActiveUsers {\n  id String\n}\n'],
    ['field attributes', 'view ActiveUsers {\n  id String @unique\n\n  @@map("active")\n}\n'],
  ])('reports a view block with %s as an unsupported top-level block', (_, view) => {
    const result = interpret(`${view}${userModel}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: 'Unsupported top-level block "view"',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 4, line: 1, column: 5 },
        },
      },
    ]);
  });

  it('reports a generator block as an unsupported top-level block', () => {
    const result = interpret(`generator client {\n  provider = "prisma-client"\n}\n${userModel}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: 'Unsupported top-level block "generator"',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 9, line: 1, column: 10 },
        },
      },
    ]);
  });
});
