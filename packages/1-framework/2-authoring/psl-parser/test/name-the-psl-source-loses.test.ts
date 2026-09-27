import { describe, expect, it } from 'vitest';
import { NAME_THE_PSL_SOURCE_LOSES } from '../src/name-the-psl-source-loses';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';

function blockMemberNames(source: string, blockName: string): readonly string[] {
  const { document, sources } = parse(source, 'test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return Object.keys(symbolTable.topLevel.blocks[blockName]?.block.parameters ?? {});
}

describe('NAME_THE_PSL_SOURCE_LOSES', () => {
  it('names a block member the parser does not keep', () => {
    expect(
      blockMemberNames(`enum Status {\n  ${NAME_THE_PSL_SOURCE_LOSES}\n  Active\n}`, 'Status'),
    ).toEqual(['Active']);
  });
});
