import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { PostgresExtensionSchemaNode } from './postgres-extension-schema-node';
import type { PostgresNamespaceSchemaNode } from './postgres-namespace-schema-node';
import type { PostgresRoleSchemaNode } from './postgres-role-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresDatabaseSchemaNodeInput {
  readonly namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>;
  readonly roles: readonly PostgresRoleSchemaNode[];
  readonly extensions: readonly PostgresExtensionSchemaNode[] | undefined;
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;
}

/**
 * The root of the Postgres schema-diff tree: one node per database.
 *
 * `id` is the fixed sentinel `'database'` — the root has no siblings and
 * the value is never emitted into migration paths. `isEqualTo` is identity
 * (roots always share the `'database'` id). `children()` yields the namespace
 * nodes followed by the role nodes — both are root-level diff subjects. The
 * differ pairs siblings by `(nodeKind, id)`, so a role and a namespace may
 * share a name without colliding. Extensions are root children too: an
 * extension's name is unique in the database.
 */
export class PostgresDatabaseSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.database;

  readonly namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>;
  readonly roles: readonly PostgresRoleSchemaNode[];
  readonly extensions: readonly PostgresExtensionSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;

  constructor(input: PostgresDatabaseSchemaNodeInput) {
    super();
    this.namespaces = Object.freeze({ ...input.namespaces });
    this.roles = Object.freeze([...input.roles]);
    this.extensions = Object.freeze([...(input.extensions ?? [])]);
    this.existingSchemas = Object.freeze([...input.existingSchemas]);
    this.pgVersion = input.pgVersion;
    freezeNode(this);
  }

  get id(): string {
    return 'database';
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [...Object.values(this.namespaces), ...this.roles, ...this.extensions];
  }

  static is(node: SqlSchemaIRNode): node is PostgresDatabaseSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.database;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresDatabaseSchemaNode {
    assertNode(node, 'PostgresDatabaseSchemaNode', PostgresDatabaseSchemaNode.is);
  }
}
