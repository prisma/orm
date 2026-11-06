import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresRoleSchemaNodeInput {
  readonly name: string;
  /**
   * Namespace coordinate. Roles are cluster-scoped; callers pass
   * `UNBOUND_NAMESPACE_ID` from `@internal/framework-components/ir`.
   */
  readonly namespaceId: string;
}

/**
 * Schema-diff leaf node for a Postgres database role.
 *
 * This is a derived, transient node walked by the differ — it is NEVER serialized.
 * Built by project-from-contract and project-from-database from their respective
 * `PostgresRole` contract entities / introspected rows.
 *
 * Roles are cluster-scoped, so `id` is the bare role name. The differ pairs
 * siblings by `(nodeKind, id)`, so a role and a namespace may share a name
 * (role `public`, schema `public`) without colliding. `isEqualTo` compares
 * ids — name-equality is role-equality for cluster-scoped objects.
 */
export class PostgresRoleSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.role;

  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleSchemaNodeInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
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
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects non-role kinds'
    >(other);
    PostgresRoleSchemaNode.assert(node);
    return this.id === node.id;
  }

  static is(node: SqlSchemaIRNode): node is PostgresRoleSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.role;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresRoleSchemaNode {
    assertNode(node, 'PostgresRoleSchemaNode', PostgresRoleSchemaNode.is);
  }
}
