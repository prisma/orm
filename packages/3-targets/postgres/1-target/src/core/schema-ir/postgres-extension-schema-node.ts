import type { ControlPolicy } from '@internal/contract/types';
import type { DiffableNode, MismatchExplanation } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresExtensionSchemaNodeInput {
  readonly name: string;
  /** The schema that holds the extension's objects (`pg_extension.extnamespace`). */
  readonly schemaName: string;
  /** The contract entity's control policy, on the expected side only. */
  readonly control: ControlPolicy | undefined;
}

/**
 * Schema-diff node for an installed Postgres extension. An extension's name is unique in the whole database, so the node sits on the database root and pairs by name alone; the schema holding its objects is compared, so an extension in another schema is one mismatch rather than a missing and an extra extension.
 */
export class PostgresExtensionSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.extension;

  readonly name: string;
  readonly schemaName: string;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresExtensionSchemaNodeInput) {
    super();
    this.name = input.name;
    this.schemaName = input.schemaName;
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
    return this.name === node.name && this.schemaName === node.schemaName;
  }

  explainMismatch(actual: DiffableNode | undefined): MismatchExplanation | undefined {
    if (actual === undefined) return undefined;
    const node = blindCast<SqlSchemaIRNode, 'the differ pairs this node with a SqlSchemaIRNode'>(
      actual,
    );
    if (!PostgresExtensionSchemaNode.is(node)) return undefined;
    return {
      text: `extension "${this.name}" is installed in schema "${node.schemaName}", and the contract declares it in schema "${this.schemaName}"`,
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
