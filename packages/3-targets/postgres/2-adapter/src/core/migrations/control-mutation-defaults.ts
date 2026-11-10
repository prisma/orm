import { sqlDefaultFunctions } from '@internal/family-sql/control';
import type { ControlMutationDefaultEntry } from '@internal/framework-components/control';

const postgresDefaultFunctionRegistryEntries = Object.entries(
  sqlDefaultFunctions(),
) satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

export function createPostgresDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(postgresDefaultFunctionRegistryEntries);
}
