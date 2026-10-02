import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { SymbolTable } from '../symbol-table';
import type { BlockSpecContext } from './types';

/** The context a block spec factory and a block-attribute spec factory are built from. ADR 255. */
export function blockSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly dataTypes: DataTypeSupport;
}): BlockSpecContext {
  return { symbols: input.symbols, dataTypes: input.dataTypes };
}
