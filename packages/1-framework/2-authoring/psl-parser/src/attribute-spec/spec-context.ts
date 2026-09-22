import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { ParsedPslExtensionBlock } from '@internal/framework-components/psl-ast';
import type { BlockSpecContext } from '../block-spec/types';
import type { BlockSymbol, FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeCtx, AttributeSpec, FieldAttributeCtx, ModelAttributeCtx } from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
  /**
   * Typed block envelopes for spec factories whose grammar depends on an
   * interpreted block (e.g. enum member default arms). Optional: callers
   * without the lifecycle result build specs that offer no block-derived
   * candidates.
   */
  readonly parsedBlocks?: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
}

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
}

export type ModelAttributeSpecFactory = (
  ctx: AttributeSpecContext,
) => AttributeSpec<never, ModelAttributeCtx>;

export type FieldAttributeSpecFactory = (
  ctx: FieldAttributeSpecContext,
) => AttributeSpec<never, FieldAttributeCtx>;

export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}

/**
 * Factory for a block-level `@@` attribute spec. Receives the same complete
 * factory context block value specs get; implementations that need no
 * context may ignore the argument.
 */
export type BlockAttributeSpecFactory = (
  ctx: BlockSpecContext,
) => AttributeSpec<never, AttributeCtx>;
