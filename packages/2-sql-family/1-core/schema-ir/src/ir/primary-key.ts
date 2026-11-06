import type { DiffableNode, SchemaNodeRef } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface PrimaryKeyInput {
  readonly columns: readonly string[];
  readonly name?: string;
  /**
   * The key's own column nodes, as root-anchored chains. The derivation
   * stamps them so the primary key is dropped before the columns it is built
   * on. Never compared by `isEqualTo`.
   */
  readonly dependsOn?: readonly SchemaNodeRef[];
}

/**
 * Primary-key Schema IR node. Mirrors the Contract IR `PrimaryKey`
 * shape (same `columns` + optional `name`) so verification can compare
 * intent and actual structurally. Defined here independently to avoid
 * a sql-schema-ir -> sql-contract dependency.
 *
 * Implements `DiffableNode` so a primary key is directly a table's diff-tree
 * child. `id` is a fixed sentinel — a table has at most one primary key, so
 * there is never a sibling to disambiguate against. `isEqualTo` compares the
 * column tuple; the PK's own `name` is a database-assigned label with no
 * semantic weight, so it is not compared (mirrors the policy node's
 * name-insensitivity to non-identifying detail).
 */
export class PrimaryKey extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.primaryKey;

  readonly columns: readonly string[];
  declare readonly name?: string;
  /** See {@link PrimaryKeyInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlColumnIR.codecRef`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];

  constructor(input: PrimaryKeyInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    freezeNode(this);
  }

  get id(): string {
    return 'primary-key';
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static from(value: PrimaryKey | PrimaryKeyInput): PrimaryKey {
    return value instanceof PrimaryKey ? value : new PrimaryKey(value);
  }

  static is(node: SqlSchemaIRNode): node is PrimaryKey {
    return node.nodeKind === RelationalSchemaNodeKind.primaryKey;
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'PrimaryKey', PrimaryKey.is);
    return (
      this.columns.length === node.columns.length &&
      this.columns.every((c, i) => c === node.columns[i])
    );
  }
}
