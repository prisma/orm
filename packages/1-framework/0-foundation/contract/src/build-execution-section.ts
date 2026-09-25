import { compareCodeUnits } from './canonicalization-storage-sort';
import type { ContractExecutionSection } from './contract-types';
import { computeExecutionHash } from './hashing';
import type { ExecutionMutationDefault } from './types';

function compareRefs(a: ExecutionMutationDefault, b: ExecutionMutationDefault): number {
  return (
    compareCodeUnits(a.ref.namespace, b.ref.namespace) ||
    compareCodeUnits(a.ref.entry, b.ref.entry) ||
    compareCodeUnits(a.ref.field, b.ref.field)
  );
}

/**
 * Builds a contract's `execution` section from its mutation defaults: sorted by namespace, entry and field in UTF-16 code-unit order, and hashed for the target. Every authoring path calls this, so they emit the same section and hash for the same defaults.
 */
export function buildExecutionSection(input: {
  readonly target: string;
  readonly targetFamily: string;
  readonly defaults: ReadonlyArray<ExecutionMutationDefault>;
}): ContractExecutionSection | undefined {
  if (input.defaults.length === 0) {
    return undefined;
  }
  const execution = { mutations: { defaults: [...input.defaults].sort(compareRefs) } };
  return {
    executionHash: computeExecutionHash({
      target: input.target,
      targetFamily: input.targetFamily,
      execution,
    }),
    ...execution,
  };
}
