import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { ParsedPslExtensionBlock } from '@internal/framework-components/psl-ast';
import { findBlockDescriptor } from '../extension-block';
import type { PslSources } from '../source-file';
import type { BlockSymbol, SymbolTable } from '../symbol-table';
import { blockSpecFactoryOf } from './descriptor';
import { interpretExtensionBlock } from './interpret';

/**
 * Re-derives the successful typed envelopes `buildSymbolTable` publishes,
 * from an already-collected table. A compatibility fallback for interpreter
 * callers that do not thread `SymbolTableResult.parsedBlocks` through
 * `PslInterpretInput` — the derivation keeps only successes, because
 * `buildSymbolTable` already reported every value and attribute failure.
 * Callers holding the lifecycle result must pass it through instead of
 * re-deriving.
 */
export function deriveParsedBlocks(
  symbolTable: SymbolTable,
  sources: PslSources,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock> {
  const parsedBlocks = new Map<BlockSymbol, ParsedPslExtensionBlock>();
  const scopes = [symbolTable.topLevel, ...Object.values(symbolTable.topLevel.namespaces)];
  for (const scope of scopes) {
    for (const block of Object.values(scope.blocks)) {
      const descriptor = findBlockDescriptor(pslBlockDescriptors, block.keyword);
      if (descriptor === undefined) continue;
      const spec = blockSpecFactoryOf(descriptor)({ symbols: symbolTable, block });
      const parsed = interpretExtensionBlock({
        block,
        descriptor,
        spec,
        symbols: symbolTable,
        sources,
      });
      if (parsed.ok) parsedBlocks.set(block, parsed.value);
    }
  }
  return parsedBlocks;
}
