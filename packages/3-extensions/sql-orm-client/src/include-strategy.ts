import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';

export type IncludeStrategy = 'join' | 'query';

const oneQueryIncludeCapabilities = [
  'jsonAgg',
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
] as const;

export function selectIncludeStrategy(contract: Contract<SqlStorage>): IncludeStrategy {
  const sql = contract.capabilities['sql'];
  return oneQueryIncludeCapabilities.every((capability) => sql?.[capability] === true)
    ? 'join'
    : 'query';
}
