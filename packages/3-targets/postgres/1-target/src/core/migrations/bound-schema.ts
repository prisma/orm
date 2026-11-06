import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

/**
 * Maps a planner schema name to the contract-free DDL builder's optional
 * `schema` field: the unbound sentinel becomes `undefined` (the builder omits
 * the schema qualifier), every other name passes through.
 */
export function boundSchema(schemaName: string): string | undefined {
  return schemaName === UNBOUND_NAMESPACE_ID ? undefined : schemaName;
}
