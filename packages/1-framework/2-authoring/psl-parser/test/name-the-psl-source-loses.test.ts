import { describe, expect, it } from 'vitest';
import { NAME_THE_PSL_SOURCE_LOSES } from '../src/name-the-psl-source-loses';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';

function blockMemberNames(source: string, blockName: string) {
  const { document, sources } = parse(source, 'test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  expect(symbolTable.topLevel.blocks[blockName]).toBeDefined();
  return Array.from(symbolTable.topLevel.blocks[blockName]!.node.entries(), (entry) =>
    entry.key()?.name(),
  );
}

describe('NAME_THE_PSL_SOURCE_LOSES', () => {
  it('keeps the formerly lost block member name', () => {
    expect(
      blockMemberNames(`enum Status {\n  ${NAME_THE_PSL_SOURCE_LOSES}\n  Active\n}`, 'Status'),
    ).toEqual(['__proto__', 'Active']);
  });

  it('keeps prototype-reserved block and member names', () => {
    expect(
      blockMemberNames('enum __proto__ {\n  __proto__\n  constructor\n  toString\n}', '__proto__'),
    ).toEqual(['__proto__', 'constructor', 'toString']);
  });
});
