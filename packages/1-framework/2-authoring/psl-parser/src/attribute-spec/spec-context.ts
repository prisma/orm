import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeSpec } from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlMutationDefaultRegistry;
}

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
}

export type ModelAttributeSpecFactory = (ctx: AttributeSpecContext) => AttributeSpec<never>;

export type FieldAttributeSpecFactory = (ctx: FieldAttributeSpecContext) => AttributeSpec<never>;

export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}
