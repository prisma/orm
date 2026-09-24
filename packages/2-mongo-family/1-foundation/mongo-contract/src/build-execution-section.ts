import { computeExecutionHash } from '@internal/contract/hashing';
import type { ContractExecutionSection, ExecutionMutationDefault } from '@internal/contract/types';

function compareRefs(a: ExecutionMutationDefault, b: ExecutionMutationDefault): number {
  return (
    a.ref.namespace.localeCompare(b.ref.namespace) ||
    a.ref.entry.localeCompare(b.ref.entry) ||
    a.ref.field.localeCompare(b.ref.field)
  );
}

/**
 * Builds a Mongo contract's `execution` section from its mutation defaults: sorted by namespace, entry and field, and hashed. PSL and TS authoring both call this, so the two paths emit the same section and hash.
 */
export function buildMongoExecutionSection(
  defaults: readonly ExecutionMutationDefault[],
): ContractExecutionSection | undefined {
  if (defaults.length === 0) {
    return undefined;
  }
  const execution = { mutations: { defaults: [...defaults].sort(compareRefs) } };
  return {
    executionHash: computeExecutionHash({ target: 'mongo', targetFamily: 'mongo', execution }),
    ...execution,
  };
}
