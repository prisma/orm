import type { Contract } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlPlannerConflict } from './types';

export const TABLE_NAME_CASE_CHANGED_CODE = 'MIGRATION.TABLE_NAME_CASE_CHANGED';

/** The one fact the guard needs about a table the plan would drop or create. */
export interface TableNameCaseGuardTable {
  readonly name: string;
}

/** A table rename the operator performs by hand, for the target to write the statements of. */
export interface TableRenameByHand {
  readonly namespaceId: string;
  readonly from: string;
  readonly to: string;
}

/** A table rename to write as a migration call; `namespaceId` is `undefined` when the call does not need to name the namespace. */
export interface TableRenameInMigration {
  readonly namespaceId: string | undefined;
  readonly from: string;
  readonly to: string;
}

interface PlannedTable {
  readonly namespaceId: string;
  readonly tableName: string;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function plannedTable(node: TableNameCaseGuardTable, namespaceId: string): PlannedTable {
  return { namespaceId, tableName: node.name };
}

function renameNeedsNamespace(
  drop: PlannedTable,
  dropped: readonly PlannedTable[],
  contract: Contract<SqlStorage>,
  defaultNamespaceId: string,
): boolean {
  if (drop.namespaceId !== UNBOUND_NAMESPACE_ID && drop.namespaceId !== defaultNamespaceId) {
    return true;
  }
  const declaredElsewhere = (namespaceId: string, tableName: string) =>
    namespaceId !== drop.namespaceId && tableName === drop.tableName;
  return (
    dropped.some((other) => declaredElsewhere(other.namespaceId, other.tableName)) ||
    Object.values(contract.storage.namespaces).some((namespace) =>
      Object.keys(namespace.entries.table ?? {}).some((tableName) =>
        declaredElsewhere(namespace.id, tableName),
      ),
    )
  );
}

/**
 * Finds every (drop `X`, create `Y`) pair in the same namespace where `X` is
 * `Y` with its first letter lowered. That shape is the signature of a schema
 * upgraded across the release in which a model with no `@@map` stopped
 * lowering the first letter of its table name: planning it would drop the
 * user's table and recreate it empty. Columns are deliberately not compared,
 * so a user who also changed a field in the same upgrade is still protected.
 *
 * Returns one conflict per pair, carrying `MIGRATION.TABLE_NAME_CASE_CHANGED`
 * in `meta.code`, or an empty array when the plan has no such pair.
 */
export function detectTableNameCaseChanges(input: {
  readonly issues: readonly SchemaDiffIssue[];
  readonly tableOf: (issue: SchemaDiffIssue) => TableNameCaseGuardTable | undefined;
  readonly namespaceIdOf: (issue: SchemaDiffIssue) => string;
  readonly renameByHandStatements: (rename: TableRenameByHand) => readonly string[];
  readonly renameTableCall: (rename: TableRenameInMigration) => string;
  readonly contract: Contract<SqlStorage>;
  readonly defaultNamespaceId: string;
}): SqlPlannerConflict[] {
  const dropped: PlannedTable[] = [];
  const created: PlannedTable[] = [];
  for (const issue of input.issues) {
    const outcome = issueOutcome(issue);
    if (outcome === 'not-equal') continue;
    const table = input.tableOf(issue);
    if (table === undefined) continue;
    (outcome === 'not-expected' ? dropped : created).push(
      plannedTable(table, input.namespaceIdOf(issue)),
    );
  }

  const conflicts: SqlPlannerConflict[] = [];
  for (const create of created) {
    const drop = dropped.find(
      (candidate) =>
        candidate.namespaceId === create.namespaceId &&
        candidate.tableName === lowerFirst(create.tableName),
    );
    if (drop === undefined) continue;
    const renameCall = input.renameTableCall({
      namespaceId: renameNeedsNamespace(drop, dropped, input.contract, input.defaultNamespaceId)
        ? drop.namespaceId
        : undefined,
      from: drop.tableName,
      to: create.tableName,
    });
    conflicts.push({
      kind: 'tableNameCaseChanged',
      summary: `${TABLE_NAME_CASE_CHANGED_CODE}: table "${create.tableName}" would be created and table "${drop.tableName}" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model ${create.tableName} points at "${create.tableName}" instead of "${drop.tableName}".`,
      why: `To keep table "${drop.tableName}" and its rows, add @@map("${drop.tableName}") to model ${create.tableName} (or run the add-model-map codemod over the schema) and plan again. To rename the table and keep its rows instead: in a project with migration history, make the rename its own schema change, create its migration with prisma migration new, and add ${renameCall} to the migration's operations, which renames the table and the objects named after it; in a project that uses db update, rename it by hand with ${input.renameByHandStatements({ namespaceId: create.namespaceId, from: drop.tableName, to: create.tableName }).join('; ')}, then run db update again.`,
      location: {
        namespaceId: create.namespaceId,
        entityKind: 'table',
        entityName: create.tableName,
      },
      meta: {
        code: TABLE_NAME_CASE_CHANGED_CODE,
        droppedTable: drop.tableName,
        createdTable: create.tableName,
      },
    });
  }
  return conflicts;
}
