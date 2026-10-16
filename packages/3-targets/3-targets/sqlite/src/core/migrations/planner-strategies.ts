/**
 * SQLite migration strategies.
 *
 * Each strategy examines the node-typed issue list, consumes issues it
 * handles, and returns the `SqliteOpFactoryCall[]` to address them. The issue
 * planner runs each strategy in order and routes whatever's left through
 * `mapNodeIssueToCall`.
 *
 * SQLite has no enums and no component-declared database dependencies. The
 * recipe that needs strategy-level multi-issue consumption is `recreateTable`,
 * which absorbs type/nullability/default/constraint mismatches, and required
 * columns added to existing tables, for a given table into one rebuild.
 */

import {
  extractCodecControlHooks,
  type FieldStatementColumns,
  type MigrationOperationClass,
  type MigrationOperationPolicy,
  type SqlSlot,
  type StatementColumn,
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
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '../codec-ids';
import { columnSpecFromNode } from './column-ddl-rendering';
import { tableSpecFromNode } from './issue-planner';
import {
  AddColumnCall,
  DataTransformCall,
  RecreateTableCall,
  type SqliteOpFactoryCall,
} from './op-factory-call';
import type { SqliteIndexSpec } from './operations/shared';
import { buildRecreatePostchecks, buildRecreateSummary } from './operations/tables';
import { sqliteFillValue } from './planner-fill-values';

export interface StrategyContext {
  /** The desired ("end") tree — resolved leaf values, incl. `codecRef`. */
  readonly expected: SqlSchemaIR;
  /** The live ("start") tree. */
  readonly actual: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /** The composed stack's codecs and data types, which write each column's type. */
  readonly types: SqlTypeLookups;
  /** The columns of the fields `--convert` and `--backfill` statements name. */
  readonly statementColumns: FieldStatementColumns;
  /** Whether a required column the plan adds to a table may take a temporary value in its rows. */
  readonly takesTemporaryValue: (table: string, column: string) => boolean;
  /**
   * The codec a column has in the origin contract. The diff's actual column cannot say: `db update`
   * plans from the introspected database, whose columns carry no codec, and SQLite's storage
   * classes do not tell an `Int` from a `BigInt`, or a `DateTime` from a `String`.
   */
  readonly originCodecId: (table: string, column: string) => string | undefined;
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

/**
 * The changes of codec a table rebuild's copy makes without losing a value: the column's type
 * affinity stores each old value as the same value of the new type. An integer becomes its decimal
 * text; a real is not listed, since SQLite writes it as text with fifteen significant digits. Keyed
 * by codec, not data type, because `Int` and `BigInt` differ only in their codec.
 */
const LOSSLESS_COPIES = new Set([
  `${SQLITE_INTEGER_CODEC_ID}→${SQLITE_TEXT_CODEC_ID}`,
  `${SQLITE_BIGINT_CODEC_ID}→${SQLITE_TEXT_CODEC_ID}`,
  `${SQLITE_INTEGER_CODEC_ID}→${SQLITE_BIGINT_CODEC_ID}`,
]);

function copyKeepsEveryValue(fromCodec: string | undefined, to: SqlColumnIR): boolean {
  const toCodec = to.codecRef?.codecId;
  return (
    fromCodec !== undefined &&
    toCodec !== undefined &&
    LOSSLESS_COPIES.has(`${fromCodec}→${toCodec}`)
  );
}

function classifyNodeIssue(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): 'widening' | 'destructive' | null {
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
      const fromCodec = ctx.originCodecId(String(issue.path[1]), actual.name);
      return expected.typeDiffersFrom(actual) && !copyKeepsEveryValue(fromCodec, expected)
        ? 'destructive'
        : 'widening';
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

function columnNode(node: unknown): SqlColumnIR {
  return blindCast<SqlColumnIR, 'a column issue carries column nodes'>(node);
}

function isColumnIssue(issue: SchemaDiffIssue): boolean {
  const node = issue.expected ?? issue.actual;
  return (
    node !== undefined &&
    blindCast<{ readonly nodeKind: string }, 'every diff-tree node declares nodeKind'>(node)
      .nodeKind === RelationalSchemaNodeKind.column
  );
}

/** The column a `--convert` or `--backfill` statement of `kind` names, if one names it. */
function statementColumn(
  ctx: StrategyContext,
  kind: 'convert' | 'backfill',
  tableName: string,
  columnName: string,
): StatementColumn | undefined {
  if (!ctx.policy.allowedOperationClasses.includes('data')) return undefined;
  return ctx.statementColumns[kind].find(
    (column) => column.table === tableName && column.column === columnName,
  );
}

/** A column the plan adds to a table the database already has. */
function addedColumn(issue: SchemaDiffIssue, ctx: StrategyContext): SqlColumnIR | undefined {
  if (issueOutcome(issue) !== 'not-found' || !isColumnIssue(issue)) return undefined;
  const tableName = issue.path[1];
  if (tableName === undefined || ctx.actual.tables[tableName] === undefined) return undefined;
  return columnNode(issue.expected);
}

/**
 * A required column with no default that the plan adds to a table the database already has, so
 * existing rows need a value for it.
 */
function addedRequiredColumn(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): SqlColumnIR | undefined {
  const column = addedColumn(issue, ctx);
  return column === undefined || column.nullable || column.resolvedDefault !== undefined
    ? undefined
    : column;
}

const CLASS_ORDER: readonly MigrationOperationClass[] = [
  'additive',
  'widening',
  'data',
  'destructive',
];

function highestClass(classes: readonly MigrationOperationClass[]): MigrationOperationClass {
  return classes.reduce(
    (highest, next) => (CLASS_ORDER.indexOf(next) > CLASS_ORDER.indexOf(highest) ? next : highest),
    'additive',
  );
}

interface TableRebuild {
  readonly issues: SchemaDiffIssue[];
  readonly classes: MigrationOperationClass[];
  /** Columns whose type changes, converted by a `--convert` copy expression or by SQLite on the copy. */
  readonly retypedColumns: string[];
  readonly copyExpressions: Record<string, SqlSlot>;
  readonly temporaryValues: Record<string, SqlSlot>;
  /** Columns an earlier call of the plan adds, which the rebuild copies like live ones. */
  readonly addedColumns: string[];
}

/**
 * Groups recreate-eligible issues by table and emits one `RecreateTableCall` per table, removing
 * the issues it consumed so `mapNodeIssueToCall` does not handle them again.
 *
 * - A type change is `destructive`, since the copy can change values, unless a `--convert`
 *   statement names the column: the copy then goes through a slot the user fills, and the rebuild
 *   is `data`. Either way the rebuild checks after its copy that every value took the new type.
 * - A nullability or constraint change alone is `widening`: a tightening copy fails on a NULL
 *   rather than losing it.
 * - A required column with no default added to an existing table is copied from a temporary value
 *   (`additive`). A column in a key or foreign key, whose values come from a value set, or whose
 *   type has no such value is carried with nothing to copy from: the rebuild succeeds on an empty
 *   table and fails on `NOT NULL` when the table has rows. A column a `--backfill` statement names
 *   was added nullable and filled by earlier calls, so the rebuild copies it like a live column.
 * - A rebuild that leaves a live column out loses its values, so it is `destructive`.
 * - Any other column added to a table the plan rebuilds, optional or with a default, and an index
 *   on it, are left to the rebuild, which creates them from the new table's spec. The plan has no
 *   separate add, so the rebuild's source table is the live one (`additive`).
 *
 * The table shapes come from `ctx.expected` and `ctx.actual`, keyed by table name: SQLite is a
 * flat, single-namespace target, and one issue only carries its own node.
 */
export const recreateTableStrategy: CallMigrationStrategy = (issues, ctx) => {
  const byTable = new Map<string, TableRebuild>();
  const consumed = new Set<SchemaDiffIssue>();
  const codecHooks = extractCodecControlHooks(ctx.frameworkComponents);
  const rebuildOf = (tableName: string): TableRebuild => {
    const existing = byTable.get(tableName);
    if (existing !== undefined) return existing;
    const created: TableRebuild = {
      issues: [],
      classes: [],
      retypedColumns: [],
      copyExpressions: {},
      temporaryValues: {},
      addedColumns: [],
    };
    byTable.set(tableName, created);
    return created;
  };

  for (const issue of issues) {
    const tableName = issue.path[1];
    if (tableName === undefined) continue;
    const added = addedRequiredColumn(issue, ctx);
    if (added !== undefined) {
      const expectedTable = ctx.expected.tables[tableName];
      if (statementColumn(ctx, 'backfill', tableName, added.name) !== undefined) {
        const rebuild = rebuildOf(tableName);
        rebuild.issues.push(issue);
        rebuild.addedColumns.push(added.name);
        rebuild.classes.push('widening');
        consumed.add(issue);
        continue;
      }
      const fill =
        expectedTable === undefined || !ctx.takesTemporaryValue(tableName, added.name)
          ? undefined
          : sqliteFillValue(added, codecHooks, ctx.types);
      const rebuild = rebuildOf(tableName);
      rebuild.issues.push(issue);
      if (fill !== undefined) rebuild.temporaryValues[added.name] = { kind: 'sql', sql: fill };
      rebuild.classes.push('additive');
      consumed.add(issue);
      continue;
    }
    const cls = classifyNodeIssue(issue, ctx);
    if (!cls) continue;
    const rebuild = rebuildOf(tableName);
    rebuild.issues.push(issue);
    consumed.add(issue);
    if (cls === 'widening') {
      rebuild.classes.push('widening');
      continue;
    }
    const column = columnNameOf(issue);
    const converted = statementColumn(ctx, 'convert', tableName, column);
    rebuild.retypedColumns.push(column);
    if (converted === undefined) {
      rebuild.classes.push('destructive');
      continue;
    }
    rebuild.copyExpressions[column] = { kind: 'placeholder', slot: `${converted.text}:convert` };
    rebuild.classes.push('data');
  }

  for (const issue of issues) {
    const rebuild = byTable.get(issue.path[1] ?? '');
    if (consumed.has(issue) || rebuild === undefined || addedColumn(issue, ctx) === undefined)
      continue;
    rebuild.issues.push(issue);
    rebuild.classes.push('additive');
    consumed.add(issue);
  }

  if (byTable.size === 0) return { kind: 'no_match' };

  const calls: SqliteOpFactoryCall[] = [];
  for (const [tableName, rebuild] of byTable) {
    const expectedTable = ctx.expected.tables[tableName];
    const actualTable = ctx.actual.tables[tableName];
    if (!expectedTable || !actualTable) continue;
    const leavesColumnsOut = Object.keys(actualTable.columns).some(
      (column) => !Object.hasOwn(expectedTable.columns, column),
    );
    const operationClass = highestClass([
      ...rebuild.classes,
      ...(leavesColumnsOut ? ['destructive' as const] : []),
    ]);

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
      new RecreateTableCall({
        tableName,
        contractTable: tableSpec,
        schemaColumnNames: [...Object.keys(actualTable.columns), ...rebuild.addedColumns],
        indexes,
        summary: buildRecreateSummary(tableName, rebuild.issues),
        postchecks: [
          ...buildRecreatePostchecks(
            tableName,
            rebuild.issues,
            tableSpec,
            new Set([
              ...Object.keys(rebuild.copyExpressions),
              ...Object.keys(rebuild.temporaryValues),
            ]),
            new Set(
              tableSpec.columns
                .filter(
                  ({ name }) => statementColumn(ctx, 'backfill', tableName, name) !== undefined,
                )
                .map(({ name }) => name),
            ),
          ),
        ],
        operationClass,
        copyExpressions: rebuild.copyExpressions,
        temporaryValues: rebuild.temporaryValues,
        retypedColumns: rebuild.retypedColumns,
      }),
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
// Backfill strategy
// ============================================================================

/**
 * Writes the calls that come before the rebuild of a column a `--backfill` statement names: for a
 * required column added to an existing table, the nullable add and a data transform whose slot the
 * user fills; for a column made required, the data transform. The rebuild that makes the column
 * NOT NULL comes from `recreateTableStrategy`, so this strategy consumes no issue. Without the
 * statement, a tightening rebuild fails on a NULL rather than guessing a value for it.
 */
export const nullabilityTighteningBackfillStrategy: CallMigrationStrategy = (issues, ctx) => {
  const calls: SqliteOpFactoryCall[] = [];
  for (const issue of issues) {
    const tableName = issue.path[1];
    if (tableName === undefined || !isColumnIssue(issue)) continue;
    const added = addedRequiredColumn(issue, ctx);
    const tightened =
      issueOutcome(issue) === 'not-equal' &&
      !columnNode(issue.expected).nullable &&
      columnNode(issue.actual).nullable
        ? columnNode(issue.expected)
        : undefined;
    const column = added ?? tightened;
    if (column === undefined) continue;
    const named = statementColumn(ctx, 'backfill', tableName, column.name);
    if (named === undefined) continue;
    if (added !== undefined) {
      calls.push(
        new AddColumnCall(tableName, {
          ...columnSpecFromNode(added, false, ctx.types),
          nullable: true,
        }),
      );
    }
    calls.push(
      new DataTransformCall(
        `data_migration.backfill-${tableName}-${column.name}`,
        `Backfill NULLs in "${tableName}"."${column.name}" before NOT NULL tightening`,
        tableName,
        column.name,
        `${named.text}:run`,
      ),
    );
  }

  if (calls.length === 0) return { kind: 'no_match' };
  return { kind: 'match', issues, calls, recipe: true };
};

export const sqlitePlannerStrategies: readonly CallMigrationStrategy[] = [
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
];
