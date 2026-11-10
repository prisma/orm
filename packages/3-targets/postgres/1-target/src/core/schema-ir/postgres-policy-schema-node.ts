import type { DiffableNode, SchemaNodeRef } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { nameOf, type SqlObjectNaming } from '@internal/sql-schema-ir/naming';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { isArrayEqual } from '@internal/utils/array-equal';
import { blindCast } from '@internal/utils/casts';
import type { RlsPolicyOperation } from '../postgres-rls-policy';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresPolicySchemaNodeInput {
  /** The node's identity. Read back off a built node with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Name of the table this policy attaches to, by name within the same schema. */
  readonly tableName: string;
  /** Namespace coordinate (schema name). */
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  /** Sorted role names rendered in `TO <roles>`. */
  readonly roles: readonly string[];
  /** USING predicate SQL string, if present. */
  readonly using: string | undefined;
  /** WITH CHECK predicate SQL string, if present. */
  readonly withCheck: string | undefined;
  /** `true` = `AS PERMISSIVE`, `false` = `AS RESTRICTIVE`. */
  readonly permissive: boolean;
  /**
   * This policy's table node, plus one entry per role it grants to — each
   * as the root-anchored chain the differ pairs siblings with. Stamped by
   * the derivation, which holds the parent (database/namespace) context.
   * Never compared by `isEqualTo`.
   */
  readonly dependsOn: readonly SchemaNodeRef[] | undefined;
}

/**
 * Schema-diff leaf node for a Postgres row-level security policy.
 *
 * This is a derived, transient node walked by the differ — it is NEVER serialized.
 * Built by project-from-contract and project-from-database from their respective
 * `PostgresRlsPolicy` contract entities / introspected rows.
 *
 * `id` is the full physical name. `isEqualTo` is mode-selected by the
 * receiver's `prefix`: a wire-named receiver (`prefix` present) compares ids
 * only — the wire name encodes a body hash, so name-equality is
 * body-equality and predicate bodies are never byte-compared (Postgres
 * reprints them). An exact receiver (`prefix` absent) compares content:
 * `operation`/`permissive` strict, `roles` sorted, and `using ?? ''` /
 * `withCheck ?? ''` verbatim byte-for-byte — reliable precisely when the
 * body text was captured from a Postgres reprint (contract infer).
 */
export class PostgresPolicySchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.policy;

  readonly name: string;
  declare readonly prefix?: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  declare readonly using?: string;
  declare readonly withCheck?: string;
  readonly permissive: boolean;
  /** See {@link PostgresPolicySchemaNodeInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlColumnIR.codecRef`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];

  constructor(input: PostgresPolicySchemaNodeInput) {
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
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects non-policy kinds'
    >(other);
    PostgresPolicySchemaNode.assert(node);
    // A wire-named receiver short-circuits to id equality — deliberately a different shape
    // from SqlIndexIR.isEqualTo (which calls contentEquals in both modes):
    // the policy hash tuple is total over the fields contentEquals compares,
    // so a wire-named policy's name equality already implies content equality.
    if (this.prefix !== undefined) {
      return this.id === node.id;
    }
    return this.contentEquals(node);
  }

  /**
   * The single policy content-equality relation — the exact-mode
   * {@link isEqualTo} and the planner's rename content-pairing both call
   * this rather than growing a parallel relation: `operation` and
   * `permissive` strict, `roles` compared deduplicated-and-sorted (the same
   * set semantics as the wire-hash tuple, so the two never disagree),
   * `using`/`withCheck` VERBATIM byte-for-byte with absent ≡ empty —
   * deliberately NOT the normalized wire-hash bodies.
   */
  contentEquals(other: PostgresPolicySchemaNode): boolean {
    return (
      this.operation === other.operation &&
      this.permissive === other.permissive &&
      isArrayEqual([...new Set(this.roles)].sort(), [...new Set(other.roles)].sort()) &&
      (this.using ?? '') === (other.using ?? '') &&
      (this.withCheck ?? '') === (other.withCheck ?? '')
    );
  }

  static is(node: SqlSchemaIRNode): node is PostgresPolicySchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.policy;
  }

  static assert(node: SqlSchemaIRNode | undefined): asserts node is PostgresPolicySchemaNode {
    assertNode(node, 'PostgresPolicySchemaNode', PostgresPolicySchemaNode.is);
  }
}
