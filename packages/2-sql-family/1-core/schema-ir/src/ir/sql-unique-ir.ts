import type { DiffableNode, SchemaNodeRef } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlUniqueIRInput {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
  /**
   * The constraint's own column nodes, as root-anchored chains. The
   * derivation stamps them so a unique constraint is dropped before the
   * columns it is built on. Never compared by `isEqualTo`.
   */
  readonly dependsOn?: readonly SchemaNodeRef[];
}

/**
 * Schema IR node for a table-level unique constraint as observed by
 * introspection.
 *
 * Implements `DiffableNode` so a unique constraint is directly a table's
 * diff-tree child. Unique constraints are frequently unnamed, so `id` is
 * derived from the column tuple rather than `name` — the column tuple is
 * also what makes two unique constraints the same constraint, so it doubles
 * as the pairing key. There are no further attributes to compare once
 * columns are equal (the differ pairs on `id`), so `isEqualTo` is identity.
 */
export class SqlUniqueIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.unique;

  readonly columns: readonly string[];
  declare readonly name?: string;
  declare readonly annotations?: SqlAnnotations;
  /** See {@link SqlUniqueIRInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlColumnIR.codecRef`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];

  constructor(input: SqlUniqueIRInput) {
    super();
    this.columns = [...input.columns];
    if (input.name !== undefined) this.name = input.name;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    freezeNode(this);
  }

  get id(): string {
    return `unique:${this.columns.join(',')}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static is(node: SqlSchemaIRNode): node is SqlUniqueIR {
    return node.nodeKind === RelationalSchemaNodeKind.unique;
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlUniqueIR', SqlUniqueIR.is);
    return this.id === node.id;
  }
}
