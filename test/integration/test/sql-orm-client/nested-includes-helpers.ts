// Shared utilities for the `nested-includes-*` integration suites.
//
// Each `*.test.ts` file in this set is intentionally small (≤ ~13 tests,
// matching the project convention visible across other files in
// `test/integration/`), split by functionality for readability.

import type { Contract } from '@internal/contract/types';
import { Collection } from '@internal/sql-orm-client';
import { contextFor, getTestContract, type IncludeStrategy, type TestContract } from './helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

type SoleNamespaceModels<T extends Contract> =
  T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

/**
 * Build a `Collection` whose contract carries the given capability
 * overrides. The runtime itself still uses the default postgres test
 * contract; the override only changes which capability flags the
 * contract advertises. Includes always lower to correlated subqueries
 * regardless of the `lateral` flag, so this knob exists to prove the
 * flag is inert for include codegen against the same real database.
 */
export function collectionWithCapabilities<
  ModelName extends keyof SoleNamespaceModels<TestContract> & string,
>(
  runtime: PgIntegrationRuntime,
  modelName: ModelName,
  capabilities: Record<string, Record<string, boolean>>,
  strategy: IncludeStrategy = 'join',
): Collection<TestContract, ModelName & string> {
  const context = contextFor({ ...getTestContract(), capabilities } as TestContract, strategy);
  return new Collection({ runtime, context }, modelName as ModelName & string, {
    namespaceId: 'public',
  });
}

// Capability fixtures for the include suites. Include codegen always
// emits correlated subqueries; the `lateral` flag is inert. These two
// shapes — one advertising `lateral`, one without it — let the suites
// assert that both resolve includes in a single correlated SQL
// execution, and that the lateral flag never produces a lateral join
// for an include.
export const ONE_QUERY_INCLUDE_CAPABILITIES = {
  jsonAgg: true,
  outerReferencesInDerivedTables: true,
  jsonAggWithoutTruncation: true,
} as const;
export const LATERAL_CAPABILITIES = {
  sql: ONE_QUERY_INCLUDE_CAPABILITIES,
  postgres: { lateral: true, jsonAgg: true },
} as const;
export const CORRELATED_CAPABILITIES = {
  sql: ONE_QUERY_INCLUDE_CAPABILITIES,
} as const;
