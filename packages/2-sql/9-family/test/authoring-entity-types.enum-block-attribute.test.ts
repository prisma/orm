import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { sqlFamilyPslBlockDescriptors } from '../src/core/authoring-entity-types';

function build(source: string) {
  const { document, sources } = parse(source, 'schema.prisma');
  return buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: sqlFamilyPslBlockDescriptors,
  });
}

describe('enum @@type through the family descriptor', () => {
  it('parses the codec id into the block attributes', () => {
    const result = build('enum Role {\n  @@type("pg/text@1")\n  Admin\n}');

    expect(result.diagnostics).toEqual([]);
    expect(result.symbolTable.topLevel.blocks['Role']?.block.attributes['type']?.args).toEqual({
      codecId: 'pg/text@1',
    });
  });

  it('rejects a non-string argument at symbol-table time', () => {
    const result = build('enum Role {\n  @@type(foo)\n  Admin\n}');

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
      }),
    ]);
    expect(result.symbolTable.topLevel.blocks['Role']?.block.attributes).toEqual({});
  });
});
