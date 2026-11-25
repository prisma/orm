import type { Contract } from '@internal/contract/types';
import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';

/** The code of a verification that failed because the database does not provide a capability the contract requires of it. */
export const VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED =
  'CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED';

/**
 * Says, in the user's terms, which capabilities `contract` requires of the database that the introspected `schema` shows it does not provide, or `undefined` when it provides them all.
 */
export type SqlDatabaseCapabilitiesNotProvidedFn = (input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
}) => string | undefined;

/** The node kind of the issue's subject. The family classifies it itself, so no target's classifier needs to know it. */
export const DATABASE_CAPABILITIES_NODE_KIND = 'database-capabilities';

/** The capabilities the contract requires of the database, as the subject of the issue that reports them not provided. */
class DatabaseCapabilitiesNode implements DiffableNode {
  readonly nodeKind = DATABASE_CAPABILITIES_NODE_KIND;
  readonly id = 'capabilities';

  constructor() {
    Object.freeze(this);
  }

  isEqualTo(other: DiffableNode): boolean {
    return other.nodeKind === this.nodeKind;
  }

  children(): readonly DiffableNode[] {
    return [];
  }
}

/**
 * The issue for capabilities the database does not provide. It holds only the expected side: an issue with no expected node is an extra, which a check across contract spaces drops from each space's result as an element some other space may own.
 */
export function databaseCapabilitiesNotProvidedIssue(text: string): SchemaDiffIssue {
  return {
    path: ['capabilities'],
    expected: new DatabaseCapabilitiesNode(),
    explanation: { text, cause: 'differs' },
  };
}
