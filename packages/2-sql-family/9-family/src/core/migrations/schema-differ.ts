import type { Contract, ControlPolicy } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';

/**
 * The full-tree node diff a SQL target produces for the family verify
 * verdict: the target derives the expected tree from the contract, applies
 * the pre-diff normalizations (semantic satisfaction, FK schema-segment
 * resolution), runs the generic differ, and ownership-scopes the result.
 * Strict gating, control-policy disposition, and the verdict itself are the
 * family's post-diff filters over this output.
 */
export interface SqlSchemaDiffResult {
  /** The full, ownership-scoped diff issue list. */
  readonly issues: readonly SchemaDiffIssue[];
  /**
   * Resolves a diff issue's subject table's declared control policy directly
   * from the contract (Decision 5's own-layer-per-concern discipline extends
   * here too: control policy is a contract concern, resolved by the target
   * at disposition time — never stamped on the diff node). `undefined`
   * when the issue's path resolves to no contract table (a genuine orphan,
   * or a non-table subject).
   */
  readonly resolveControlPolicy: (issue: SchemaDiffIssue) => ControlPolicy | undefined;
  /**
   * The expected/actual namespace-node pairs the codec `verifyType` hooks
   * run over — one per contract namespace with tables, paired by DDL
   * schema; a flat target repeats its sole actual root per such namespace.
   */
  readonly namespacePairs: ReadonlyArray<{ readonly actual: SqlSchemaIRNode | undefined }>;
}

export interface SqlSchemaDiffInput {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export type SqlSchemaDiffFn = (input: SqlSchemaDiffInput) => SqlSchemaDiffResult;
