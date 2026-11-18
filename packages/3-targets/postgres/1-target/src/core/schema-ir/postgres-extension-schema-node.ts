import type { ControlPolicy } from '@internal/contract/types';
import type { DiffableNode, MismatchExplanation } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

/**
 * Where an extension is. A contract declares it in one schema (`declared`) or leaves it to the connection's search path (`searchPath`, the unbound namespace); a node read from the database knows the schema it is installed in and that connection's search path (`installed`).
 */
export type PostgresExtensionLocation =
  | { readonly kind: 'declared'; readonly schemaName: string }
  | { readonly kind: 'searchPath' }
  | {
      readonly kind: 'installed';
      readonly schemaName: string;
      /** The connection's search path, as `current_schemas(true)` reports it. */
      readonly searchPath: readonly string[];
    };

export interface PostgresExtensionSchemaNodeInput {
  readonly name: string;
  readonly location: PostgresExtensionLocation;
  /** The contract entity's control policy, on the expected side only. */
  readonly control: ControlPolicy | undefined;
}

/**
 * Schema-diff node for a Postgres extension. An extension's name is unique in the whole database, so the node sits on the database root and pairs by name alone; its location is compared, so an extension in another schema is one mismatch rather than a missing and an extra extension. An extension the contract leaves to the search path matches an installed one in any schema on the installed node's search path, and any contract-side node, since only a connection decides where it is. An extension a contract declares in a schema never matches one an earlier contract left to the search path, because it may be in any schema on it: the planner moves it with a checked `ALTER EXTENSION … SET SCHEMA`, which the runner skips when it is already there.
 */
export class PostgresExtensionSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.extension;

  readonly name: string;
  readonly location: PostgresExtensionLocation;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresExtensionSchemaNodeInput) {
    super();
    this.name = input.name;
    this.location =
      input.location.kind === 'installed'
        ? Object.freeze({
            ...input.location,
            searchPath: Object.freeze([...input.location.searchPath]),
          })
        : Object.freeze({ ...input.location });
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
    if (this.location.kind === 'searchPath') {
      return node.location.kind !== 'installed' || isOnSearchPath(node.location);
    }
    if (node.location.kind === 'searchPath') return false;
    return this.location.schemaName === node.location.schemaName;
  }

  explainMismatch(actual: DiffableNode | undefined): MismatchExplanation | undefined {
    if (actual === undefined) return undefined;
    const node = blindCast<SqlSchemaIRNode, 'the differ pairs this node with a SqlSchemaIRNode'>(
      actual,
    );
    if (!PostgresExtensionSchemaNode.is(node)) return undefined;
    if (this.location.kind === 'searchPath') {
      invariant(
        node.location.kind === 'installed',
        'an extension left to the search path differs only from an installed extension',
      );
      return {
        text: `extension "${this.name}" ${offSearchPathText(node.location)}. ${searchPathFix(node.location)}`,
        cause: 'differs',
      };
    }
    if (node.location.kind === 'searchPath') {
      return {
        text: `extension "${this.name}" was left to the search path, so it may be in any schema on it, and the contract declares it in schema "${this.location.schemaName}"`,
        cause: 'differs',
      };
    }
    return {
      text: `extension "${this.name}" is installed in schema "${node.location.schemaName}", and the contract declares it in schema "${this.location.schemaName}"`,
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

type InstalledLocation = Extract<PostgresExtensionLocation, { readonly kind: 'installed' }>;

function isOnSearchPath(location: InstalledLocation): boolean {
  return location.searchPath.includes(location.schemaName);
}

/** Names the schema an extension is installed in and the search path that does not include it. */
export function offSearchPathText(location: InstalledLocation): string {
  return `is installed in schema "${location.schemaName}", which is not on the search path (${location.searchPath.join(', ')})`;
}

/** What fixes an extension installed in a schema off the search path. */
export function searchPathFix(location: InstalledLocation): string {
  return `Add schema "${location.schemaName}" to the connection's search_path, or reinstall the extension in a schema on it.`;
}
