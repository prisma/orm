import { asNamespaceId, type NamespaceId } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from './sql-node';

/**
 * Input for a foreign-key reference (one side of a foreign-key declaration).
 *
 * When `spaceId` is absent the reference is local — the referenced table lives
 * in the same contract-space. When `spaceId` is present the reference is
 * cross-space — the referenced table lives in a different contract-space
 * identified by `spaceId`.
 *
 * Presence-based discrimination keeps local FK JSON byte-identical to
 * contracts authored before cross-space support was added.
 */
export interface ForeignKeyReferenceInput {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly spaceId?: string;
}

/**
 * SQL Contract IR node for one side (source or target) of a foreign-key
 * declaration. Carries the full coordinate: namespace, table, and columns.
 *
 * Cross-space discrimination is based on `spaceId` presence: absent means
 * local (same contract-space); present means cross-space (the referenced
 * table lives in the contract-space identified by `spaceId`).
 *
 * For local references `spaceId` is absent from JSON, keeping the serialized
 * shape byte-identical to contracts authored before cross-space support was
 * added. For cross-space references `spaceId` appears in JSON so round-trips
 * are lossless.
 *
 * Use `UNBOUND_NAMESPACE_ID` from `@internal/framework-components/ir`
 * as the sentinel `namespaceId` for single-namespace (unbound) references.
 */
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: NamespaceId;
  readonly tableName: string;
  readonly columns: readonly string[];
  declare readonly spaceId?: string;

  constructor(input: ForeignKeyReferenceInput) {
    super();
    this.namespaceId = asNamespaceId(input.namespaceId);
    this.tableName = input.tableName;
    this.columns = input.columns;
    if (input.spaceId !== undefined) this.spaceId = input.spaceId;
    freezeNode(this);
  }

  static from(value: ForeignKeyReference | ForeignKeyReferenceInput): ForeignKeyReference {
    return value instanceof ForeignKeyReference ? value : new ForeignKeyReference(value);
  }
}
