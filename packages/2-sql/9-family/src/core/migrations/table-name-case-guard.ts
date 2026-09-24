import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import type { SqlPlannerConflict } from './types';

export const TABLE_NAME_CASE_CHANGED_CODE = 'MIGRATION.TABLE_NAME_CASE_CHANGED';

/** The one fact the guard needs about a table the plan would drop or create. */
export interface TableNameCaseGuardTable {
  readonly name: string;
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
    conflicts.push({
      kind: 'tableNameCaseChanged',
      summary: `${TABLE_NAME_CASE_CHANGED_CODE}: table "${create.tableName}" would be created and table "${drop.tableName}" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model ${create.tableName} points at "${create.tableName}" instead of "${drop.tableName}".`,
      why: `To keep table "${drop.tableName}" and its rows, add @@map("${drop.tableName}") to model ${create.tableName} (or run the add-model-map codemod over the schema) and plan again. Prisma 8 has no rename-table operation, so a deliberate rename is done by hand: run ALTER TABLE "${drop.tableName}" RENAME TO "${create.tableName}" (schema-qualified where applicable), after which the plan is empty.`,
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
