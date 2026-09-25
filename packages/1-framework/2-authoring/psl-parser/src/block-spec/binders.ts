import type { ArgType, AttributeCtx, NamedOut, OutOf, Param } from '../attribute-spec/types';
import type { EntriesBlockSpec, FixedBlockSpec } from './types';

export function fixedBlock<const P extends Record<string, Param<unknown, AttributeCtx>>>(config: {
  readonly parameters: P;
}): FixedBlockSpec<NamedOut<P>> {
  return { mode: 'fixed', parameters: config.parameters };
}

export function entriesBlock<R extends ArgType<unknown, AttributeCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
}): EntriesBlockSpec<Record<string, OutOf<R>>>;
export function entriesBlock<R extends ArgType<unknown, AttributeCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare: true;
}): EntriesBlockSpec<Record<string, OutOf<R> | undefined>>;
export function entriesBlock<R extends ArgType<unknown, AttributeCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare?: true;
}): EntriesBlockSpec<Record<string, OutOf<R> | undefined>> {
  return { mode: 'entries', value: config.value, allowBare: config.allowBare ?? false };
}
