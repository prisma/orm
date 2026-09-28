import type { ArgType, AttributeCtx, NamedOut, OutOf, Param } from '../attribute-spec/types';
import type { MapBlockSpec, StructBlockSpec } from './types';

export function structBlock<const P extends Record<string, Param<unknown, AttributeCtx>>>(config: {
  readonly parameters: P;
}): StructBlockSpec<NamedOut<P>> {
  return { mode: 'struct', parameters: config.parameters };
}

export function mapBlock<
  R extends ArgType<unknown, AttributeCtx>,
  Bare extends boolean = false,
>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare?: Bare;
}): MapBlockSpec<Record<string, Bare extends true ? OutOf<R> | undefined : OutOf<R>>> {
  return { mode: 'map', value: config.value, allowBare: config.allowBare ?? false };
}
