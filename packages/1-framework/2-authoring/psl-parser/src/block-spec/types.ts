import type { ArgType, AttributeCtx, Param } from '../attribute-spec/types';
import type { BlockSymbol, SymbolTable } from '../symbol-table';

/**
 * Context handed to block spec factories and block attribute spec factories.
 * `symbols` feeds the parse context; `block` serves attribute interpretation
 * and metadata inspection, not reference resolution — reference rules derive
 * lexical scope from the expression's syntax ancestry.
 */
export interface BlockSpecContext {
  readonly symbols: SymbolTable;
  readonly block: BlockSymbol;
}

/** The one reusable rule an entries block applies to every arbitrary key. */
export interface BlockEntryValueSpec {
  readonly type: ArgType<unknown, AttributeCtx>;
  readonly documentation: string;
}

/**
 * A block whose body is a closed set of declared keys. Fixed keys are
 * required unless their rule is `optional(...)`; optional defaults follow
 * the shared attribute default metadata.
 */
export interface FixedBlockSpec<Out = unknown> {
  readonly mode: 'fixed';
  readonly parameters: Readonly<Record<string, Param<unknown, AttributeCtx>>>;
  readonly _out?: Out;
}

/**
 * A block whose body accepts arbitrary keys, each bound through one shared
 * value rule. With `allowBare`, a key may stand alone on its line; the
 * output record then carries the key with an `undefined` value — the bare
 * sentinel, distinct from an explicit JSON null.
 */
export interface EntriesBlockSpec<Out = unknown> {
  readonly mode: 'entries';
  readonly value: BlockEntryValueSpec;
  readonly allowBare: boolean;
  readonly _out?: Out;
}

export type BlockSpec<Out = unknown> = FixedBlockSpec<Out> | EntriesBlockSpec<Out>;

export type InferBlock<S> = S extends BlockSpec<infer Out> ? Out : never;

/**
 * The concrete factory type behind `AuthoringPslBlockDescriptor.spec`, which
 * the framework core stores erased as `unknown`.
 */
export type BlockSpecFactory = (ctx: BlockSpecContext) => BlockSpec<unknown>;
