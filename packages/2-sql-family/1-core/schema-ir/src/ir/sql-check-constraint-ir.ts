import type { DiffableNode, SchemaNodeRef } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { nameOf, type SqlObjectNaming } from '../naming';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlCheckConstraintIRInput {
  /** The node's identity. Read back off a built node with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Opaque SQL: the predicate body, without the surrounding `CHECK (…)`. */
  readonly expression: string;
  /**
   * The check's own column nodes, as root-anchored chains. The derivation
   * stamps chains to every column of its table — a deterministic
   * over-approximation, since the opaque predicate is never parsed — so a
   * check is dropped before the columns it constrains (Postgres drops the
   * constraint along with a covered column, which would strand the
   * constraint's own drop). Never compared by `isEqualTo`.
   */
  readonly dependsOn: readonly SchemaNodeRef[] | undefined;
}

/**
 * Schema IR node for a table-level check constraint, carried as an opaque
 * predicate. The expression is never parsed — a database reprints predicates
 * in its own normalized form, so any structured reading of it would drift.
 *
 * Implements `DiffableNode` so a check is directly a table's diff-tree child;
 * `id` is `check:<name>`. `isEqualTo` is mode-selected by the receiver's
 * `prefix` (the differ always calls `expected.isEqualTo(actual)`): a
 * wire-named receiver compares ids only — the wire name's hash already
 * commits to the predicate — while an exact-named receiver byte-compares the
 * expression, which is reliable precisely when both sides came from the same
 * reprint.
 */
export class SqlCheckConstraintIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.check;

  readonly name: string;
  declare readonly prefix?: string;
  readonly expression: string;
  /** See {@link SqlCheckConstraintIRInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlIndexIR.dependsOn`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];

  constructor(input: SqlCheckConstraintIRInput) {
    super();
    this.name = nameOf(input.naming);
    if (input.naming.kind === 'wire') this.prefix = input.naming.prefix;
    this.expression = input.expression;
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    freezeNode(this);
  }

  get id(): string {
    return `check:${this.name}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static from(value: SqlCheckConstraintIR | SqlCheckConstraintIRInput): SqlCheckConstraintIR {
    return value instanceof SqlCheckConstraintIR ? value : new SqlCheckConstraintIR(value);
  }

  static is(node: SqlSchemaIRNode): node is SqlCheckConstraintIR {
    return node.nodeKind === RelationalSchemaNodeKind.check;
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlCheckConstraintIR', SqlCheckConstraintIR.is);
    if (this.prefix !== undefined) return this.id === node.id;
    return this.expression === node.expression;
  }
}
