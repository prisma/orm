import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';
import { SqlTableIR, type SqlTableIRInput } from './sql-table-ir';

export interface SqlSchemaIRInput {
  readonly tables: Record<string, SqlTableIR | SqlTableIRInput>;
  readonly annotations?: SqlAnnotations;
}

/**
 * Root Schema IR node representing the complete database schema as
 * observed by introspection. Target-agnostic; used by both verifiers
 * (compare against intended Contract storage) and migration planners
 * (derive operations needed to reconcile).
 *
 * The constructor normalises nested `SqlTableIR` instances so
 * downstream walks see a uniform AST regardless of whether the input
 * was a plain-data literal or already-constructed class instances.
 *
 * Implements `DiffableNode` as the root of a flat (single-schema) diff
 * tree: `id` is the fixed sentinel `'database'` (roots have no siblings),
 * `isEqualTo` is identity (a container has no own attributes), and
 * `children()` yields the table nodes.
 */
export class SqlSchemaIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.schema;

  readonly tables: Readonly<Record<string, SqlTableIR>>;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlSchemaIRInput) {
    super();
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([key, t]) => [
          key,
          t instanceof SqlTableIR ? t : new SqlTableIR(t),
        ]),
      ),
    );
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }

  get id(): string {
    return 'database';
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return Object.values(this.tables);
  }
}
