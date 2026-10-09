import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { ok } from '@internal/utils/result';
import { expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { str } from '../src/attribute-spec/combinators/str';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import type { ArgType, BlockAttributeCtx } from '../src/attribute-spec/types';
import { structBlock } from '../src/block-spec/constructors';
import { interpretExtensionBlocks } from '../src/block-spec/interpret';
import type { BlockSpecContext } from '../src/block-spec/types';
import { parse } from '../src/parse';
import type { BlockSymbol } from '../src/symbol-table';
import { buildSymbolTable } from '../src/symbol-table';
import { supportBinder } from './support';

const ownBlockName: ArgType<string, BlockAttributeCtx> = {
  ...str(),
  parse: (_arg, ctx) => ok(ctx.selfBlock.name),
};

it('passes the block being parsed to its values and attributes through the parse context', () => {
  const factoryContexts: BlockSpecContext[] = [];
  const refinedBlocks: BlockSymbol[] = [];
  const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
    tagged: {
      kind: 'pslBlock',
      keyword: 'tagged',
      discriminator: 'fixture-tagged',
      name: { required: true },
      spec: (ctx: BlockSpecContext) => {
        factoryContexts.push(ctx);
        return structBlock({
          parameters: { owner: { type: ownBlockName, documentation: 'The owning block.' } },
        });
      },
      attributes: {
        mark: (ctx: BlockSpecContext) => {
          factoryContexts.push(ctx);
          return blockAttribute('mark', {
            documentation: 'Marks the block.',
            positional: [{ key: 'value', type: ownBlockName, documentation: 'The owner.' }],
            refine: (_parsed, refineCtx) => {
              refinedBlocks.push(refineCtx.selfBlock);
              return [];
            },
          });
        },
      },
    },
  };
  const { document, sources } = parse(
    'tagged First {\n  owner = x\n  @@mark(y)\n}\ntagged Second {\n  owner = x\n}',
    'self-block.psl',
  );
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });

  const { parsedBlocks, diagnostics } = interpretExtensionBlocks({
    symbolTable,
    sources,
    pslBlockDescriptors,
    binder: supportBinder({ sources, symbolTable, pslBlockDescriptors }),
    dataTypes: EMPTY_DATA_TYPES,
  });

  const first = symbolTable.topLevel.blocks['First']!;
  const second = symbolTable.topLevel.blocks['Second']!;
  expect(diagnostics).toEqual([]);
  expect(parsedBlocks.get(first)).toMatchObject({
    values: { owner: 'First' },
    attributes: { mark: { args: { value: 'First' } } },
  });
  expect(parsedBlocks.get(second)).toMatchObject({ values: { owner: 'Second' } });
  expect(refinedBlocks).toEqual([first]);
  expect(factoryContexts.length).toBeGreaterThan(0);
  for (const ctx of factoryContexts) {
    expect(ctx).toEqual({ symbols: symbolTable, dataTypes: EMPTY_DATA_TYPES });
  }
});
