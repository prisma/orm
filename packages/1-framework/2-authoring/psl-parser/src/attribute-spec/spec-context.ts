import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { Resolution } from '../binder';
import type { BlockSymbol, FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeCtx, AttributeSpec, FieldAttributeCtx, ModelAttributeCtx } from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
}

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
  readonly typeResolution: Resolution | undefined;
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

export interface BlockAttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly block: BlockSymbol;
}

export type BlockAttributeSpecFactory = (
  ctx: BlockAttributeSpecContext,
) => AttributeSpec<never, AttributeCtx>;
