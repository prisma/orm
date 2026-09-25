import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { BlockSpecContext } from '../block-spec/types';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeSpec, BoundCtx, FieldAttributeCtx, ModelAttributeCtx } from './types';

/**
 * Construction-time context for attribute spec factories. Factories run
 * inside binder construction, so the context carries symbol and registry
 * facts only — never the binder and never interpreted envelopes; a grammar
 * that depends on a block (e.g. enum member default arms) reads names from
 * the block's syntax through the symbol table.
 */
export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
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
export type BlockAttributeSpecFactory = (ctx: BlockSpecContext) => AttributeSpec<never, BoundCtx>;
