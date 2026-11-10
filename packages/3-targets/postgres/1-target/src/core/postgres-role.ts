import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';

/**
 * Roles are referenced by the contract but never owned — the framework
 * issues no `CREATE`/`DROP ROLE`, so a role's effective governance is always
 * `external`: a missing declared role fails verify, an extra live role is
 * tolerated, and the planner emits zero role DDL. `external` is the only
 * value a role's control can ever carry.
 */
export const ROLE_DEFAULT_CONTROL_POLICY = 'external';

export interface PostgresRoleInput {
  readonly name: string;
  /**
   * Namespace coordinate. Roles are cluster-scoped; pass `UNBOUND_NAMESPACE_ID`
   * from `@internal/framework-components/ir`.
   */
  readonly namespaceId: string;
  /**
   * Defaults to {@link ROLE_DEFAULT_CONTROL_POLICY} when omitted. Roles are
   * referenced but never owned, so `'external'` is the only allowed value.
   */
  readonly control?: 'external';
}

/**
 * Postgres contract-IR class for a database role (`CREATE ROLE …`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree uses `PostgresRoleSchemaNode` for that role.
 *
 * Roles are cluster-scoped, so their namespace coordinate is always
 * `UNBOUND_NAMESPACE_ID`. Target-only concept — no SQL-family abstract.
 * Extends `SqlNode` directly, frozen at construction via `freezeNode(this)`.
 * The `kind: 'role'` discriminant is enumerable so it survives JSON.
 * Matches the entries key (one-string rule).
 *
 * `control` always carries a value (never omitted): it defaults to
 * {@link ROLE_DEFAULT_CONTROL_POLICY} in the constructor, so both a
 * freshly-authored role and one hydrated from an older `contract.json`
 * lacking the field resolve the same way — the control-policy resolver
 * reads it directly off the entity instead of special-casing role issues.
 */
export class PostgresRole extends SqlNode {
  override readonly kind = 'role' as const;
  readonly name: string;
  readonly namespaceId: string;
  readonly control: 'external';

  constructor(input: PostgresRoleInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
    this.control = input.control ?? ROLE_DEFAULT_CONTROL_POLICY;
    freezeNode(this);
  }
}
