import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';
import { nameOf, type SqlObjectNaming } from '@internal/sql-schema-ir/naming';

export type RlsPolicyOperation = 'select' | 'insert' | 'update' | 'delete' | 'all';

export interface PostgresRlsPolicyInput {
  /** The policy's identity. Read back off a built entity with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Name of the table this policy attaches to, by name within the same schema. */
  readonly tableName: string;
  /** Namespace coordinate (schema name). Policies are schema-scoped. */
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  /** Sorted role names rendered in `TO <roles>`. Plain strings for now. */
  readonly roles: readonly string[];
  /** USING predicate SQL string, if present. */
  readonly using: string | undefined;
  /** WITH CHECK predicate SQL string, if present. */
  readonly withCheck: string | undefined;
  /** `true` = `AS PERMISSIVE`, `false` = `AS RESTRICTIVE`. */
  readonly permissive: boolean;
}

/** Keys whose value may be absent become omittable. */
type AbsentKeysOmittable<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
};

/**
 * The policy literal a generated migration file carries, and the parameter
 * `Migration#createRlsPolicy` accepts. Same shape as
 * {@link PostgresRlsPolicyInput} — naming union included — except that absent
 * values are spelled by omitting the key, which is how a machine-rendered
 * literal writes them. Deriving it keeps the field list in one place.
 */
export type RenderedRlsPolicyLiteral = AbsentKeysOmittable<PostgresRlsPolicyInput>;

/**
 * Postgres contract-IR class for a row-level security policy (`CREATE POLICY … ON …`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree uses `PostgresPolicySchemaNode` for that role.
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly.
 * Frozen at construction via `freezeNode(this)`. The `kind: 'policy'`
 * discriminant is enumerable (overrides SqlNode's non-enumerable `'sql'`) so it
 * survives JSON serialization and enables dispatch. The literal matches the
 * entries key (one-string rule: node.kind === entries key === entity kind).
 */
export class PostgresRlsPolicy extends SqlNode {
  override readonly kind = 'policy' as const;
  readonly name: string;
  declare readonly prefix?: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  declare readonly using?: string;
  declare readonly withCheck?: string;
  readonly permissive: boolean;

  constructor(input: PostgresRlsPolicyInput) {
    super();
    this.name = nameOf(input.naming);
    if (input.naming.kind === 'wire') this.prefix = input.naming.prefix;
    this.tableName = input.tableName;
    this.namespaceId = input.namespaceId;
    this.operation = input.operation;
    this.roles = Object.freeze([...input.roles]);
    if (input.using !== undefined) this.using = input.using;
    if (input.withCheck !== undefined) this.withCheck = input.withCheck;
    this.permissive = input.permissive;
    freezeNode(this);
  }
}
