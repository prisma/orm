import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { Resolution } from '../binder';
import type { BlockSpecContext } from '../block-spec/types';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type {
  AttributeSpec,
  BlockAttributeCtx,
  FieldAttributeCtx,
  ModelAttributeCtx,
} from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
  readonly dataTypes: DataTypeSupport;
}

/** The data types of a stack that registers none. */
export const EMPTY_DATA_TYPES: DataTypeSupport = { entries: {}, lookup: createDataTypeLookup([]) };

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

export type BlockAttributeSpecFactory = (
  ctx: BlockSpecContext,
) => AttributeSpec<never, BlockAttributeCtx>;
