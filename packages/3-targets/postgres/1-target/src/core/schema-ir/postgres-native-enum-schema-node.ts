import type { ControlPolicy } from '@internal/contract/types';
import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresNativeEnumSchemaNodeInput {
  /** The Postgres type name (`CREATE TYPE <typeName> AS ENUM (…)`). */
  readonly typeName: string;
  /** The owning DDL schema name — enum types are schema-scoped. */
  readonly namespaceId: string;
  /** Member values in declaration (`pg_enum.enumsortorder`) order. */
  readonly members: readonly string[];
  /** The contract entity's control grade — expected-side nodes only. */
  readonly control?: ControlPolicy;
}

/**
 * Schema-diff leaf node for a native Postgres enum type.
 *
 * This is a derived, transient node walked by the differ — it is NEVER
 * serialized. Both sides derive it on the namespace node: the expected side
 * from the contract's hydrated `entries.native_enum` entities, the actual
 * side from the adapter's introspected `nativeEnums`.
 *
 * Enum types are schema-scoped, so identity is (namespace, type name): the
 * namespace coordinate comes from tree position (the differ pairs enum nodes
 * only inside an already-paired namespace) and `id` carries the type name,
 * prefixed with the entries-kind vocabulary (`native_enum:<typeName>`) so it
 * cannot collide with a sibling table of the same name — the same
 * sibling-prefix convention relational column nodes use (`column:<name>`).
 *
 * `isEqualTo` compares members POSITIONALLY — `['a','b'] ≠ ['b','a']` —
 * because Postgres enum sort order is semantic. `control` is contract
 * metadata, not database state, and does not participate in equality.
 */
export class PostgresNativeEnumSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.nativeEnum;

  readonly typeName: string;
  readonly namespaceId: string;
  readonly members: readonly string[];
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresNativeEnumSchemaNodeInput) {
    super();
    this.typeName = input.typeName;
    this.namespaceId = input.namespaceId;
    this.members = Object.freeze([...input.members]);
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }

  get id(): string {
    return `native_enum:${this.typeName}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects non-enum kinds'
    >(other);
    PostgresNativeEnumSchemaNode.assert(node);
    return (
      this.typeName === node.typeName &&
      this.members.length === node.members.length &&
      this.members.every((member, index) => member === node.members[index])
    );
  }

  static is(node: SqlSchemaIRNode): node is PostgresNativeEnumSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.nativeEnum;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresNativeEnumSchemaNode {
    assertNode(node, 'PostgresNativeEnumSchemaNode', PostgresNativeEnumSchemaNode.is);
  }
}
