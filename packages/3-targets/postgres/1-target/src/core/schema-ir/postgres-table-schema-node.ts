import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import {
  assertNode,
  PrimaryKey,
  type SqlAnnotations,
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIRNode,
  type SqlTableIRInput,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import type { PostgresPolicySchemaNode } from './postgres-policy-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresTableSchemaNodeInput extends SqlTableIRInput {
  readonly policies?: readonly PostgresPolicySchemaNode[];
  /**
   * Whether row-level security is enabled on this table. Expected side:
   * stamped from the contract's `entries.rls` marker (never from the
   * policy set). Actual side: stamped from `pg_class.relrowsecurity` at
   * introspection. Required with no default so every construction site
   * supplies a deliberate value.
   */
  readonly rlsEnabled: boolean;
}

/**
 * Postgres-specific table schema-diff node. Carries all `SqlTableIR` fields
 * plus `policies`, and implements `DiffableNode` so the table instance is
 * directly the diff-tree node — no separate wrapper needed.
 *
 * Extends `SqlSchemaIRNode` directly rather than `SqlTableIR` because
 * `SqlTableIR` calls `freezeNode` in its own constructor, which prevents
 * subclass field initialisation.
 *
 * `id` is the table name. `isEqualTo` compares id + `rlsEnabled` — the
 * table's one own diffable attribute; all other structural drift is
 * expressed by its children. `children()` returns every column, the primary
 * key (when present), every foreign key, unique, index, and check constraint,
 * plus the policy nodes — one flat list, so a drifted column and a drifted
 * policy are both reported by the same walk. Order is deterministic (object
 * key order for columns, array order for the rest) so two structurally equal
 * tables always produce the same child list.
 */
export class PostgresTableSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.table;

  readonly name: string;
  readonly columns: Readonly<Record<string, SqlColumnIR>>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR>;
  readonly uniques: ReadonlyArray<SqlUniqueIR>;
  readonly indexes: ReadonlyArray<SqlIndexIR>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly annotations?: SqlAnnotations;
  declare readonly checks?: ReadonlyArray<SqlCheckConstraintIR>;
  readonly policies: readonly PostgresPolicySchemaNode[];
  readonly rlsEnabled: boolean;

  constructor(input: PostgresTableSchemaNodeInput) {
    super();
    this.name = input.name;
    this.rlsEnabled = input.rlsEnabled;
    this.columns = Object.freeze(
      Object.fromEntries(
        Object.entries(input.columns).map(([key, col]) => [
          key,
          col instanceof SqlColumnIR ? col : new SqlColumnIR(col),
        ]),
      ),
    );
    this.foreignKeys = Object.freeze(
      input.foreignKeys.map((fk) => (fk instanceof SqlForeignKeyIR ? fk : new SqlForeignKeyIR(fk))),
    );
    this.uniques = Object.freeze(
      input.uniques.map((u) => (u instanceof SqlUniqueIR ? u : new SqlUniqueIR(u))),
    );
    this.indexes = Object.freeze(
      input.indexes.map((i) => (i instanceof SqlIndexIR ? i : new SqlIndexIR(i))),
    );
    if (input.primaryKey !== undefined) {
      this.primaryKey =
        input.primaryKey instanceof PrimaryKey
          ? input.primaryKey
          : new PrimaryKey(input.primaryKey);
    }
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.checks !== undefined && input.checks.length > 0) {
      this.checks = Object.freeze(
        input.checks.map((c) =>
          c instanceof SqlCheckConstraintIR ? c : new SqlCheckConstraintIR(c),
        ),
      );
    }
    this.policies = Object.freeze([...(input.policies ?? [])]);
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  /**
   * Equal iff the ids (names) match AND `rlsEnabled` matches — the table's
   * one own attribute in the diff; all other structural drift is expressed
   * by children. A paired `not-equal` therefore always means enablement
   * drift, which the planner maps to ENABLE/DISABLE ROW LEVEL SECURITY.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    PostgresTableSchemaNode.assert(node);
    return this.id === node.id && this.rlsEnabled === node.rlsEnabled;
  }

  children(): readonly DiffableNode[] {
    return [
      ...Object.values(this.columns),
      ...(this.primaryKey ? [this.primaryKey] : []),
      ...this.foreignKeys,
      ...this.uniques,
      ...this.indexes,
      ...(this.checks ?? []),
      ...this.policies,
    ];
  }

  static is(node: SqlSchemaIRNode): node is PostgresTableSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.table;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresTableSchemaNode {
    assertNode(node, 'PostgresTableSchemaNode', PostgresTableSchemaNode.is);
  }
}
