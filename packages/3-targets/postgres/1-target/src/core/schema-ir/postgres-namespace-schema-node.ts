import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { PostgresNativeEnumSchemaNode } from './postgres-native-enum-schema-node';
import type { PostgresTableSchemaNode } from './postgres-table-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresNamespaceSchemaNodeInput {
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  /**
   * The native-enum diff nodes belonging to this namespace, member values in
   * `pg_enum.enumsortorder` (declaration) order. The expected
   * (contract-projected) side attaches each node's `control` (the contract
   * entity's grade); introspection builds nodes with no `control`.
   */
  readonly nativeEnums?: readonly PostgresNativeEnumSchemaNode[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace. Per-schema consumers (the relational planner,
 * toSchemaView) read this node's `tables` field structurally via
 * `blindCast`/`SqlSchemaIRNode` — not through a static `SqlSchemaIR`
 * assignment — because `nodeKind` carries this node's own literal
 * (`postgres-namespace`), distinct from `SqlSchemaIR`'s own (`sql-schema`).
 *
 * `id` is the schema name; `isEqualTo` is identity on it; `children()` returns
 * the table nodes plus `nativeEnums`.
 *
 * `nativeEnums` is the diff-tree representation of native enum types the
 * differ pairs — the sole enum carrier, built directly by both sides: the
 * expected (contract-projected) side and introspection alike hand in
 * `PostgresNativeEnumSchemaNode`s.
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.namespace;

  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnums: readonly PostgresNativeEnumSchemaNode[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tables = Object.freeze({ ...input.tables });
    this.nativeEnums = Object.freeze([...(input.nativeEnums ?? [])]);
    freezeNode(this);
  }

  get id(): string {
    return this.schemaName;
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [...Object.values(this.tables), ...this.nativeEnums];
  }

  static is(node: SqlSchemaIRNode): node is PostgresNamespaceSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.namespace;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresNamespaceSchemaNode {
    assertNode(node, 'PostgresNamespaceSchemaNode', PostgresNamespaceSchemaNode.is);
  }
}
