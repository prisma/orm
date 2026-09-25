import type { ArgType, AttributeCtx, NamedOut, OutOf, Param } from '../attribute-spec/types';
import type { EntriesBlockSpec, FixedBlockSpec } from './types';

export function fixedBlock<const P extends Record<string, Param<unknown, AttributeCtx>>>(config: {
  readonly parameters: P;
}): FixedBlockSpec<NamedOut<P>> {
  return { mode: 'fixed', parameters: config.parameters };
}

export function entriesBlock<
  R extends ArgType<unknown, AttributeCtx>,
  Bare extends boolean = false,
>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare?: Bare;
}): EntriesBlockSpec<Record<string, Bare extends true ? OutOf<R> | undefined : OutOf<R>>> {
  return { mode: 'entries', value: config.value, allowBare: config.allowBare ?? false };
}
