import { buildExecutionSection } from '@internal/contract/hashing';
import type { ContractExecutionSection, ExecutionMutationDefault } from '@internal/contract/types';

export function buildMongoExecutionSection(
  defaults: readonly ExecutionMutationDefault[],
): ContractExecutionSection | undefined {
  return buildExecutionSection({ target: 'mongo', targetFamily: 'mongo', defaults });
}
