import { parseNaming } from '@internal/sql-schema-ir/naming';
import type { PostgresRlsPolicyInput, RlsPolicyOperation } from './postgres-rls-policy';

/**
 * A policy as `contract.json` stores it: full `name`, optional `prefix` whose
 * presence marks wire mode. The `policy` entity kind hydrates it through
 * {@link policyInputFromSerialized}.
 */
export type SerializedRlsPolicy = {
  readonly name: string;
  readonly prefix?: string | undefined;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  readonly using?: string | undefined;
  readonly withCheck?: string | undefined;
  readonly permissive: boolean;
};

/**
 * Hydrates one stored policy into constructor input. The name and the prefix
 * are separate fields in the file and can disagree there, so the pair is
 * checked on the way in.
 */
export function policyInputFromSerialized(flat: SerializedRlsPolicy): PostgresRlsPolicyInput {
  return {
    naming: parseNaming(flat.name, flat.prefix),
    tableName: flat.tableName,
    namespaceId: flat.namespaceId,
    operation: flat.operation,
    roles: flat.roles,
    using: flat.using,
    withCheck: flat.withCheck,
    permissive: flat.permissive,
  };
}
