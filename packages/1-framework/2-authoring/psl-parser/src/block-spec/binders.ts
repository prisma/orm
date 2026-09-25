import type { ArgType, BoundCtx, NamedOut, OutOf, Param } from '../attribute-spec/types';
import type { EntriesBlockSpec, FixedBlockSpec } from './types';

/**
 * Declares a block with a closed set of keys. Unknown keys are rejected;
 * declared keys are required unless their rule is `optional(...)`, in which
 * case the shared default metadata applies. Required/optional property
 * inference reuses `NamedOut`, matching named attribute arguments.
 */
export function fixedBlock<const P extends Record<string, Param<unknown, BoundCtx>>>(config: {
  readonly parameters: P;
}): FixedBlockSpec<NamedOut<P>> {
  return { mode: 'fixed', parameters: config.parameters };
}

/**
 * Declares a block whose body accepts arbitrary keys, each bound through one
 * shared value rule. The `allowBare: true` overload additionally permits a
 * bare member line, surfaced as a present key with an `undefined` value —
 * distinct from an explicit JSON null.
 */
export function entriesBlock<R extends ArgType<unknown, BoundCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
}): EntriesBlockSpec<Record<string, OutOf<R>>>;
export function entriesBlock<R extends ArgType<unknown, BoundCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare: true;
}): EntriesBlockSpec<Record<string, OutOf<R> | undefined>>;
export function entriesBlock<R extends ArgType<unknown, BoundCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare?: true;
}): EntriesBlockSpec<Record<string, OutOf<R> | undefined>> {
  return { mode: 'entries', value: config.value, allowBare: config.allowBare ?? false };
}
