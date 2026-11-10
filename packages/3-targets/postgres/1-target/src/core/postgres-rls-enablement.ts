import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';

export interface PostgresRlsEnablementInput {
  /** Name of the table this marker declares RLS-controlled. */
  readonly tableName: string;
  /** Namespace coordinate (schema name). Markers are schema-scoped like policies. */
  readonly namespaceId: string;
}

/**
 * Postgres contract-IR marker for `@@rls` on a model: the table named here is
 * RLS-controlled (`ENABLE ROW LEVEL SECURITY` is driven by this marker, never
 * by the policy set).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an
 * entity kind, extends `SqlNode`, and is stored in `contract.json` under
 * `entries.rls[tableName]`. Target-only concept — no SQL-family abstract.
 * Frozen at construction via `freezeNode(this)`. The `kind: 'rls'`
 * discriminant is enumerable so it survives JSON serialization; the literal
 * matches the entries key (one-string rule).
 */
export class PostgresRlsEnablement extends SqlNode {
  override readonly kind = 'rls' as const;
  readonly tableName: string;
  readonly namespaceId: string;

  constructor(input: PostgresRlsEnablementInput) {
    super();
    this.tableName = input.tableName;
    this.namespaceId = input.namespaceId;
    freezeNode(this);
  }
}
