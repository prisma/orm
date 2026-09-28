import type { ArgType, AttributeCtx, Param } from '../attribute-spec/types';
import type { BlockSymbol, SymbolTable } from '../symbol-table';

export interface BlockSpecContext {
  readonly symbols: SymbolTable;
  readonly block: BlockSymbol;
}

export interface BlockEntryValueSpec {
  readonly type: ArgType<unknown, AttributeCtx>;
  readonly documentation: string;
}

export interface StructBlockSpec<Out = unknown> {
  readonly mode: 'struct';
  readonly parameters: Readonly<Record<string, Param<unknown, AttributeCtx>>>;
  readonly _out?: Out;
}

export interface MapBlockSpec<Out = unknown> {
  readonly mode: 'map';
  readonly value: BlockEntryValueSpec;
  readonly allowBare: boolean;
  readonly _out?: Out;
}

export type BlockSpec<Out = unknown> = StructBlockSpec<Out> | MapBlockSpec<Out>;

export type InferBlock<S> = S extends BlockSpec<infer Out> ? Out : never;

export type BlockSpecFactory = (
  ctx: BlockSpecContext,
) => BlockSpec<Readonly<Record<string, unknown>>>;
