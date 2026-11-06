import { sqlDefaultFunctions } from '@internal/family-sql/control';
import type { ControlMutationDefaultEntry } from '@internal/framework-components/control';

const sqliteDefaultFunctionRegistryEntries = Object.entries(
  sqlDefaultFunctions(),
) satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

export function createSqliteDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(sqliteDefaultFunctionRegistryEntries);
}
