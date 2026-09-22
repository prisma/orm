import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeCtx, AttributeSpec, FieldAttributeCtx, ModelAttributeCtx } from './types';

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

export type BlockAttributeSpecFactory = () => AttributeSpec<never, AttributeCtx>;
