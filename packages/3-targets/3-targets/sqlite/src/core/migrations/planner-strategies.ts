/**
 * SQLite migration strategies.
 *
 * Each strategy examines the node-typed issue list, consumes issues it
 * handles, and returns the `SqliteOpFactoryCall[]` to address them. The issue
 * planner runs each strategy in order and routes whatever's left through
 * `mapNodeIssueToCall`.
 *
 * SQLite has no enums, no data-safe backfill, and no component-declared
 * database dependencies. The only recipe that needs strategy-level
 * multi-issue consumption is `recreateTable`, which absorbs
 * type/nullability/default/constraint mismatches for a given table into a
 * single recreate operation.
 */

import type {
  MigrationOperationClass,
  MigrationOperationPolicy,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlSchemaIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { columnTypeChanged, tableSpecFromNode } from './issue-planner';
import { DataTransformCall, RecreateTableCall, type SqliteOpFactoryCall } from './op-factory-call';
import type { SqliteIndexSpec } from './operations/shared';
import { buildRecreatePostchecks, buildRecreateSummary } from './operations/tables';

export interface StrategyContext {
  /** The desired ("end") tree — resolved leaf values, incl. `codecRef`. */
  readonly expected: SqlSchemaIR;
  /** The live ("start") tree. */
  readonly actual: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /** The composed stack's codecs and data types, which write each column's type. */
  readonly types: SqlTypeLookups;
}

export type CallMigrationStrategy = (
  issues: readonly SchemaDiffIssue[],
  context: StrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaDiffIssue[];
      calls: readonly SqliteOpFactoryCall[];
      recipe?: boolean;
    }
  | { kind: 'no_match' };

// ============================================================================
// Recreate-table strategy
// ============================================================================

/**
 * Classifies a node issue into the operation class a recreate absorbing it
 * would need, or `null` when the strategy doesn't handle this node/reason at
 * all (table/column not-found-or-not-expected, and index issues — those are
 * standalone ops, never folded into a recreate).
 *
 * Column drift is a single `not-equal` issue (type and nullability compared
 * together by `SqlColumnIR.isEqualTo`): a type change is destructive, because
 * the copy can change values; a nullability change alone is widening, because
 * a tightening copy fails on a NULL rather than losing it.
 */
/** The column of a column issue, which `classifyNodeIssue` classes destructive only for a type change. */
function columnNameOf(issue: SchemaDiffIssue): string {
  return blindCast<SqlColumnIR, 'a destructive recreate issue is a not-equal column issue'>(
    issue.expected,
  ).name;
}

function classifyNodeIssue(issue: SchemaDiffIssue): 'widening' | 'destructive' | null {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return null;
  const nodeKind = blindCast<
    { readonly nodeKind: string },
    'every diff-tree node declares nodeKind'
  >(node).nodeKind;
  switch (nodeKind) {
    case RelationalSchemaNodeKind.column: {
      if (issueOutcome(issue) !== 'not-equal') return null;
      const expected = blindCast<SqlColumnIR, 'a not-equal column issue carries the expected node'>(
        issue.expected,
      );
      const actual = blindCast<SqlColumnIR, 'a not-equal column issue carries the actual node'>(
        issue.actual,
      );
      return columnTypeChanged(expected, actual) ? 'destructive' : 'widening';
    }
    case RelationalSchemaNodeKind.columnDefault:
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.foreignKey:
    case RelationalSchemaNodeKind.unique:
      return 'widening';
    default:
      return null;
  }
}

/**
 * Groups recreate-eligible issues by table, decides per-table operation class
 * (destructive wins over widening, and a recreate that leaves a live column
 * out of the new table loses its values, so it is destructive), and emits one `RecreateTableCall` per
 * table. Returns unchanged-or-smaller issue list — issues the strategy
 * consumed are removed so `mapNodeIssueToCall` doesn't double-handle them.
 *
 * The full desired/live table shapes come from `ctx.expected`/`ctx.actual`
 * directly (keyed by table name — SQLite is a flat, single-namespace target)
 * rather than from any individual issue, since a single drifted attribute's
 * issue only carries that attribute's own node, never the whole table.
 */
export const recreateTableStrategy: CallMigrationStrategy = (issues, ctx) => {
  const byTable = new Map<
    string,
    { issues: SchemaDiffIssue[]; hasDestructive: boolean; lossyColumns: string[] }
  >();
  const consumed = new Set<SchemaDiffIssue>();

  for (const issue of issues) {
    const cls = classifyNodeIssue(issue);
    if (!cls) continue;
    const tableName = issue.path[1];
    if (tableName === undefined) continue;
    const entry = byTable.get(tableName) ?? {
      issues: [],
      hasDestructive: false,
      lossyColumns: [],
    };
    entry.issues.push(issue);
    if (cls === 'destructive') {
      entry.hasDestructive = true;
      entry.lossyColumns.push(columnNameOf(issue));
    }
    byTable.set(tableName, entry);
    consumed.add(issue);
  }

  if (byTable.size === 0) return { kind: 'no_match' };

  const calls: SqliteOpFactoryCall[] = [];
  for (const [tableName, entry] of byTable) {
    const expectedTable = ctx.expected.tables[tableName];
    const actualTable = ctx.actual.tables[tableName];
    if (!expectedTable || !actualTable) continue;
    const leavesColumnsOut = Object.keys(actualTable.columns).some(
      (column) => !Object.hasOwn(expectedTable.columns, column),
    );
    const operationClass: MigrationOperationClass =
      entry.hasDestructive || leavesColumnsOut ? 'destructive' : 'widening';

    // Flatten the expected table node to a self-contained spec — the Call
    // holds pre-rendered SQL fragments only, no schema-IR node.
    const tableSpec = tableSpecFromNode(expectedTable, ctx.types);

    // Indexes (declared + FK-backing) are already merged and deduped by
    // column-set at derivation (`contractToSchemaIR`'s `convertTable`).
    const indexes: SqliteIndexSpec[] = expectedTable.indexes.map((idx) => ({
      name: idx.name,
      columns: idx.columns ?? [],
    }));

    calls.push(
      new RecreateTableCall(
        {
          tableName,
          contractTable: tableSpec,
          schemaColumnNames: Object.keys(actualTable.columns),
          indexes,
          summary: buildRecreateSummary(tableName, entry.issues),
          postchecks: buildRecreatePostchecks(tableName, entry.issues, tableSpec),
          operationClass,
        },
        entry.lossyColumns,
      ),
    );
  }

  return {
    kind: 'match',
    issues: issues.filter((i) => !consumed.has(i)),
    calls,
    recipe: true,
  };
};

// ============================================================================
// Nullability-tightening backfill strategy
// ============================================================================

/**
 * When the policy allows `'data'` and the expected tree tightens one or more
 * columns from nullable to NOT NULL, emit a `DataTransformCall` stub per
 * tightened column. The user fills the backfill `UPDATE` in the rendered
 * `migration.ts` before the subsequent `RecreateTableCall` copies data into
 * the tightened schema (whose `INSERT INTO temp SELECT … FROM old` would
 * otherwise fail at runtime if any `NULL`s remain).
 *
 * Does NOT consume the tightening issue — `recreateTableStrategy` still
 * needs it to produce the actual recreate that enforces the NOT NULL at
 * the schema level. The backfill op and the recreate op end up in the
 * recipe slot in strategy order (backfill first, recreate second), which
 * matches the required execution order.
 *
 * Mirrors Postgres's `nullableTighteningCallStrategy`. When `'data'` is not
 * in the policy (the default `db update` / `db init` path), the strategy
 * short-circuits and the recreate alone runs, failing at runtime if NULLs
 * are present.
 */
export const nullabilityTighteningBackfillStrategy: CallMigrationStrategy = (issues, ctx) => {
  if (!ctx.policy.allowedOperationClasses.includes('data')) {
    return { kind: 'no_match' };
  }

  const calls: SqliteOpFactoryCall[] = [];
  for (const issue of issues) {
    if (
      issueOutcome(issue) !== 'not-equal' ||
      issue.expected === undefined ||
      issue.actual === undefined
    ) {
      continue;
    }
    const expected = blindCast<
      { readonly nodeKind: string },
      'every diff-tree node declares nodeKind'
    >(issue.expected).nodeKind;
    if (expected !== RelationalSchemaNodeKind.column) continue;

    const expectedColumn = blindCast<
      SqlColumnIR,
      'a not-equal column issue carries the expected node'
    >(issue.expected);
    const actualColumn = blindCast<SqlColumnIR, 'a not-equal column issue carries the actual node'>(
      issue.actual,
    );
    if (expectedColumn.nullable === actualColumn.nullable) continue; // not a nullability change
    if (expectedColumn.nullable) continue; // relaxing — no backfill needed

    const tableName = issue.path[1];
    if (tableName === undefined) continue;

    calls.push(
      new DataTransformCall(
        `data_migration.backfill-${tableName}-${expectedColumn.name}`,
        `Backfill NULLs in "${tableName}"."${expectedColumn.name}" before NOT NULL tightening`,
        tableName,
        expectedColumn.name,
      ),
    );
  }

  if (calls.length === 0) return { kind: 'no_match' };

  return {
    kind: 'match',
    issues,
    calls,
    recipe: true,
  };
};

export const sqlitePlannerStrategies: readonly CallMigrationStrategy[] = [
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
];
