import { buildSymbolTable, interpretExtensionBlocks } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { sqlFamilyPslBlockDescriptors } from '../src/core/authoring-entity-types';

function build(source: string) {
  const { document, sources } = parse(source, 'schema.prisma');
  const result = buildSymbolTable({ documents: [document], sources });
  const { parsedBlocks, diagnostics: blockDiagnostics } = interpretExtensionBlocks(
    result.symbolTable,
    sources,
    sqlFamilyPslBlockDescriptors,
  );
  return { ...result, blockDiagnostics, parsedBlocks };
}

describe('enum @@type through the family descriptor', () => {
  it('parses the codec id into the block attributes', () => {
    const result = build('enum Role {\n  @@type("pg/text@1")\n  Admin\n}');

    expect(result.diagnostics).toEqual([]);
    const block = result.symbolTable.topLevel.blocks['Role'];
    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(result.parsedBlocks.get(block)?.attributes['type']?.args).toEqual({
      codecId: 'pg/text@1',
    });
  });

  it('rejects a non-string argument when the blocks are resolved', () => {
    const result = build('enum Role {\n  @@type(foo)\n  Admin\n}');

    expect(result.blockDiagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
      }),
    ]);
    const block = result.symbolTable.topLevel.blocks['Role'];
    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(result.parsedBlocks.has(block)).toBe(false);
  });
});
