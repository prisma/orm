import type { ControlPolicy } from '@internal/contract/types';
import type { DiffableNode, MismatchExplanation } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresExtensionSchemaNodeInput {
  readonly name: string;
  /** The schema that holds the extension's objects (`pg_extension.extnamespace`); `undefined` for an extension the contract declares in the unbound namespace, which the search path locates. */
  readonly schemaName: string | undefined;
  /** The connection's search path, as `current_schemas(true)` reports it, on a node read from the database only. */
  readonly searchPath: readonly string[] | undefined;
  /** The contract entity's control policy, on the expected side only. */
  readonly control: ControlPolicy | undefined;
}

/**
 * Schema-diff node for an installed Postgres extension. An extension's name is unique in the whole database, so the node sits on the database root and pairs by name alone; the schema holding its objects is compared, so an extension in another schema is one mismatch rather than a missing and an extra extension. An expected node with no schema, declared in the unbound namespace, matches a live extension in any schema on the live node's search path, and any node read with no connection, since only a connection decides where it is.
 */
export class PostgresExtensionSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.extension;

  readonly name: string;
  declare readonly schemaName?: string;
  declare readonly searchPath?: readonly string[];
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresExtensionSchemaNodeInput) {
    super();
    this.name = input.name;
    if (input.schemaName !== undefined) this.schemaName = input.schemaName;
    if (input.searchPath !== undefined) this.searchPath = Object.freeze([...input.searchPath]);
    if (input.control !== undefined) this.control = input.control;
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
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects other kinds'
    >(other);
    PostgresExtensionSchemaNode.assert(node);
    if (this.name !== node.name) return false;
    if (this.schemaName === undefined) {
      return node.searchPath === undefined || node.searchPath.includes(node.installedSchemaName());
    }
    return this.schemaName === node.installedSchemaName();
  }

  /** The schema the extension is in. An unbound declaration, compared with no connection, is taken to be in `public`, where `CREATE EXTENSION` with no schema puts it under the default search path. */
  installedSchemaName(): string {
    return this.schemaName ?? DEFAULT_NAMESPACE_ID;
  }

  explainMismatch(actual: DiffableNode | undefined): MismatchExplanation | undefined {
    if (actual === undefined) return undefined;
    const node = blindCast<SqlSchemaIRNode, 'the differ pairs this node with a SqlSchemaIRNode'>(
      actual,
    );
    if (!PostgresExtensionSchemaNode.is(node)) return undefined;
    if (this.schemaName === undefined && node.searchPath !== undefined) {
      return {
        text: `extension "${this.name}" ${offSearchPathText(node.installedSchemaName(), node.searchPath)}`,
        cause: 'differs',
      };
    }
    return {
      text: `extension "${this.name}" is installed in schema "${node.installedSchemaName()}", and the contract declares it in schema "${this.schemaName}"`,
      cause: 'differs',
    };
  }

  static is(node: SqlSchemaIRNode): node is PostgresExtensionSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.extension;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresExtensionSchemaNode {
    assertNode(node, 'PostgresExtensionSchemaNode', PostgresExtensionSchemaNode.is);
  }
}

/** Names the schema an extension is installed in and the search path that does not include it. */
export function offSearchPathText(schemaName: string, searchPath: readonly string[]): string {
  return `is installed in schema "${schemaName}", which is not on the search path (${searchPath.join(', ')})`;
}
