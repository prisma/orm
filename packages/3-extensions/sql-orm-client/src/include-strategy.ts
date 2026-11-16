import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ormError } from './orm-errors';
import type { CollectionState, IncludeExpr } from './types';

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

/** Whether a read leaves its includes to statements of their own, one query per relation. */
export function loadsIncludesPerRelation(
  contract: Contract<SqlStorage>,
  includes: readonly IncludeExpr[],
): boolean {
  return includes.length > 0 && selectIncludeStrategy(contract) === 'query';
}

/**
 * A prepared read is one statement, and includes that load with one query per relation take several.
 */
export function assertPreparableIncludes(
  contract: Contract<SqlStorage>,
  state: CollectionState,
  method: string,
): void {
  if (!loadsIncludesPerRelation(contract, state.includes)) {
    return;
  }
  const capabilities = oneQueryIncludeCapabilities.map((capability) => `sql.${capability}`);
  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `prepared.${method}() with includes requires contract capabilities ${capabilities.join(', ')}: without them includes load with one query per relation, and a prepared read is one statement.`,
    { meta: { capabilities, method: `prepared.${method}` } },
  );
}
