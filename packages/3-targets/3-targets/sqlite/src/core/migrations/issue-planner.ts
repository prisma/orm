/**
 * SQLite migration issue planner.
 *
 * Takes node-typed schema-diff issues (from the one differ — see
 * `buildSqlitePlanDiff` in `diff-database-schema.ts`) and emits migration IR
 * (`SqliteOpFactoryCall[]`). Strategies consume issues they recognize and
 * produce specialized call sequences (e.g. `recreateTableStrategy` absorbs
 * type/nullability/default/constraint mismatches into a single recreate op);
 * remaining issues flow through `mapNodeIssueToCall` for the default case.
 *
 * Every branch reads the diff node the issue carries (`issue.expected` /
 * `issue.actual`) — never the contract, never `storageTypes`, never codec
 * hooks. Column DDL resolves from the column node's `codecRef`
 * (`column-ddl-rendering.ts`), never a recomputation against the contract.
 */

import type {
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome, orderIssuesByDependencies } from '@internal/framework-components/control';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlIndexIR,
  SqlSchemaIR,
  type SqlSchemaIRNode,
  type SqlTableIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import { CONTROL_TABLE_NAMES } from '../control-tables';
import {
  columnSpecFromNode,
  ddlColumnFromNode,
  isInlineAutoincrementPrimaryKeyNode,
  tableConstraintsFromNode,
} from './column-ddl-rendering';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  type SqliteOpFactoryCall,
} from './op-factory-call';
import type {
  SqliteColumnSpec,
  SqliteForeignKeySpec,
  SqliteTableSpec,
  SqliteUniqueSpec,
} from './operations/shared';
import {
  type CallMigrationStrategy,
  type StrategyContext,
  sqlitePlannerStrategies,
} from './planner-strategies';

export type { CallMigrationStrategy, StrategyContext };

// ============================================================================
// Subtree coalescing — the planner's responsibility per the differ's contract
// ============================================================================

/**
 * The generic differ is total: a missing/extra table (or column) emits an
 * issue for itself AND for every node in its subtree (columns, defaults,
 * constraints, indexes). `CreateTableCall`/`DropTableCall` and
 * `AddColumnCall`/`DropColumnCall` already account for the whole subtree
 * (reading it directly off the table/column node), so the nested issues are
 * redundant — coalescing them is "the planner's responsibility" the differ's
 * own contract assigns (`schema-diff.ts`). Drops any issue whose path is a
 * strict descendant of a `not-found`/`not-expected` issue's path.
 */
export function coalesceSubtreeIssues(
  issues: readonly SchemaDiffIssue[],
): readonly SchemaDiffIssue[] {
  const collapsingPaths = issues
    .filter(
      (issue) => issueOutcome(issue) === 'not-found' || issueOutcome(issue) === 'not-expected',
    )
    .map((issue) => issue.path);
  if (collapsingPaths.length === 0) return issues;
  return issues.filter(
    (issue) => !collapsingPaths.some((ancestor) => isStrictDescendantPath(issue.path, ancestor)),
  );
}

function isStrictDescendantPath(path: readonly string[], ancestor: readonly string[]): boolean {
  if (path.length <= ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i += 1) {
    if (path[i] !== ancestor[i]) return false;
  }
  return true;
}

// ============================================================================
// Node helpers
// ============================================================================

export function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
  >(node);
}

/** Whether the expected/actual native type (resolved, or raw+many fallback) differs — mirrors `SqlColumnIR.isEqualTo`'s type comparison. */
export function columnTypeChanged(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.resolvedNativeType !== undefined && actual.resolvedNativeType !== undefined) {
    return expected.resolvedNativeType !== actual.resolvedNativeType;
  }
  return (
    expected.nativeType !== actual.nativeType || Boolean(expected.many) !== Boolean(actual.many)
  );
}

/**
 * Builds the flat `SqliteTableSpec` `RecreateTableCall` needs from the
 * expected table node — the node-sourced equivalent of the retired
 * `toTableSpec` (which read a raw contract `StorageTable`). Every column's
 * spec is resolved from its `codecRef` via `columnSpecFromNode`.
 */
export function tableSpecFromNode(table: SqlTableIR): SqliteTableSpec {
  const columns: SqliteColumnSpec[] = Object.values(table.columns).map((c) =>
    columnSpecFromNode(c, isInlineAutoincrementPrimaryKeyNode(table, c)),
  );
  const uniques: SqliteUniqueSpec[] = table.uniques.map((u) => ({
    columns: u.columns,
    ...(u.name !== undefined ? { name: u.name } : {}),
  }));
  // Every FK node on the expected tree is constraint-bearing by construction
  // (a persisted `foreignKeys[]` entry is a constraint; a non-constraint FK
  // contributes only a backing index, never an FK node).
  const foreignKeys: SqliteForeignKeySpec[] = table.foreignKeys.map((fk) => ({
    columns: fk.columns,
    references: { table: fk.referencedTable, columns: fk.referencedColumns },
    ...(fk.name !== undefined ? { name: fk.name } : {}),
    ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
    ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
  }));
  return {
    columns,
    ...(table.primaryKey ? { primaryKey: { columns: table.primaryKey.columns } } : {}),
    uniques,
    foreignKeys,
  };
}

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function issueLocation(tableName: string, columnName?: string): SqlPlannerConflictLocation {
  return columnName !== undefined
    ? { entityKind: 'table', entityName: tableName, column: columnName }
    : { entityKind: 'table', entityName: tableName };
}

/**
 * Conflict kind for a node kind that `recreateTableStrategy` absorbs for
 * every reachable production issue. Reaching `mapNodeIssueToCall` for one of
 * these means the recreate strategy didn't run — mirrors the legacy
 * `conflictKindForIssue` per-kind categorization.
 */
function absorbedConflictKind(nodeKind: string): SqlPlannerConflict['kind'] {
  switch (nodeKind) {
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.unique:
      return 'indexIncompatible';
    case RelationalSchemaNodeKind.foreignKey:
      return 'foreignKeyConflict';
    default:
      return 'missingButNonAdditive';
  }
}

// ============================================================================
// StorageTable / StorageColumn → flat SqliteTableSpec / DdlColumn helpers
// ============================================================================

/**
 * Builds the `CreateTableCall` + per-index `CreateIndexCall`s for a
 * newly-expected table. Reads only the table node's own children — indexes
 * (declared + FK-backing, deduped) are already merged and ordered at
 * derivation (`contractToSchemaIR`'s `convertTable`).
 */
function buildCreateTableCalls(table: SqlTableIR): SqliteOpFactoryCall[] {
  const columns = Object.values(table.columns).map((c) =>
    ddlColumnFromNode(c, isInlineAutoincrementPrimaryKeyNode(table, c)),
  );
  const hasInlinePk = Object.values(table.columns).some((c) =>
    isInlineAutoincrementPrimaryKeyNode(table, c),
  );
  const constraints = tableConstraintsFromNode(table, hasInlinePk);
  const calls: SqliteOpFactoryCall[] = [
    new CreateTableCall(table.name, columns, constraints.length > 0 ? constraints : undefined),
  ];
  for (const index of table.indexes) {
    const indexName = index.name;
    calls.push(new CreateIndexCall(table.name, indexName, index.columns ?? []));
  }
  return calls;
}

// ============================================================================
// Issue → Call mapping (per-issue default path)
// ============================================================================

function mapTableIssue(
  issue: SchemaDiffIssue,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const table = blindCast<
      SqlTableIR,
      'a not-found table issue always carries the expected table node'
    >(issue.expected);
    return ok(buildCreateTableCalls(table));
  }
  if (issueOutcome(issue) === 'not-expected') {
    const table = blindCast<
      SqlTableIR,
      'a not-expected table issue always carries the actual table node'
    >(issue.actual);
    // Runner-owned control tables must never be dropped.
    if (CONTROL_TABLE_NAMES.has(table.name)) return ok([]);
    return ok([new DropTableCall(table.name)]);
  }
  // Unreachable: SqlTableIR.isEqualTo is identity, so a paired table can
  // never mismatch — kept for exhaustiveness against a future node change.
  return notOk(
    issueConflict('unsupportedOperation', `Unexpected table drift: ${issue.path.join('/')}`),
  );
}

function mapColumnIssue(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const tableName = issue.path[1];
  if (tableName === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Column issue has no table in its path: ${issue.path.join('/')}`,
      ),
    );
  }
  if (issueOutcome(issue) === 'not-found') {
    const column = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    // A sole-autoincrement-PK column is always part of the table's own
    // CREATE (never a bare ADD COLUMN — PK changes go through
    // `recreateTableStrategy`), but the check is cheap and keeps this path
    // honest against the table node rather than assuming it.
    const table = ctx.expected.tables[tableName];
    const inline = table !== undefined && isInlineAutoincrementPrimaryKeyNode(table, column);
    return ok([new AddColumnCall(tableName, columnSpecFromNode(column, inline))]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const column = blindCast<
      SqlColumnIR,
      'a not-expected column issue always carries the actual column node'
    >(issue.actual);
    return ok([new DropColumnCall(tableName, column.name)]);
  }
  // not-equal: absorbed by recreateTableStrategy for every reachable
  // production issue (SQLite can't ALTER a column type/nullability in
  // place). Reaching here means the strategy didn't run — conflict.
  const expected = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the expected column node'
  >(issue.expected);
  const actual = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the actual column node'
  >(issue.actual);
  const kind = columnTypeChanged(expected, actual) ? 'typeMismatch' : 'nullabilityConflict';
  return notOk(issueConflict(kind, issue.path.join('/'), issueLocation(tableName, expected.name)));
}

function mapIndexIssue(
  issue: SchemaDiffIssue,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const tableName = issue.path[1];
  if (tableName === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Index issue has no table in its path: ${issue.path.join('/')}`,
      ),
    );
  }
  if (issueOutcome(issue) === 'not-found') {
    const index = blindCast<
      SqlIndexIR,
      'a not-found index issue always carries the expected index node'
    >(issue.expected);
    const indexName = index.name;
    return ok([new CreateIndexCall(tableName, indexName, index.columns ?? [])]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const index = blindCast<
      SqlIndexIR,
      'a not-expected index issue always carries the actual index node'
    >(issue.actual);
    const indexName = index.name;
    return ok([new DropIndexCall(tableName, indexName)]);
  }
  // not-equal: index type/options/uniqueness drift. SQLite can't ALTER an
  // index in place and the legacy planner never absorbed this into a
  // recreate either — surfaces as a conflict, matching `index_mismatch`.
  return notOk(issueConflict('indexIncompatible', issue.path.join('/'), issueLocation(tableName)));
}

export function mapNodeIssueToCall(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const node = issueNode(issue);
  if (node === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Issue carries neither an expected nor an actual node: ${issue.path.join('/')}`,
      ),
    );
  }
  switch (node.nodeKind) {
    case RelationalSchemaNodeKind.table:
      return mapTableIssue(issue);
    case RelationalSchemaNodeKind.column:
      return mapColumnIssue(issue, ctx);
    case RelationalSchemaNodeKind.index:
      return mapIndexIssue(issue);
    case RelationalSchemaNodeKind.columnDefault:
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.foreignKey:
    case RelationalSchemaNodeKind.unique:
      return notOk(issueConflict(absorbedConflictKind(node.nodeKind), issue.path.join('/')));
    case RelationalSchemaNodeKind.check:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `The SQLite target does not support CHECK constraint DDL: ${issue.path.join('/')}`,
        ),
      );
    default:
      return notOk(issueConflict('unsupportedOperation', `Unhandled node kind: ${node.nodeKind}`));
  }
}

// ============================================================================
// Call categorization for final emission order
// ============================================================================

type CallCategory =
  | 'drop-column'
  | 'drop-index'
  | 'drop-table'
  | 'create-table'
  | 'add-column'
  | 'create-index';

function classifyCall(call: SqliteOpFactoryCall): CallCategory | null {
  switch (call.factoryName) {
    case 'createTable':
      return 'create-table';
    case 'addColumn':
      return 'add-column';
    case 'createIndex':
      return 'create-index';
    case 'dropColumn':
      return 'drop-column';
    case 'dropIndex':
      return 'drop-index';
    case 'dropTable':
      return 'drop-table';
    // recreateTable goes into the recipe slot; return null for bucketable.
    case 'recreateTable':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Top-level planIssues
// ============================================================================

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaDiffIssue[];
  /** The desired ("end") tree — resolved leaf values, incl. `codecRef`. */
  readonly expected?: SqlSchemaIR;
  /** The live ("start") tree. */
  readonly actual?: SqlSchemaIR;
  readonly policy?: MigrationOperationPolicy;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly CallMigrationStrategy[];
}

export interface IssuePlannerValue {
  readonly calls: readonly SqliteOpFactoryCall[];
}

const DEFAULT_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    expected: options.expected ?? emptySchemaIR(),
    actual: options.actual ?? emptySchemaIR(),
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? sqlitePlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: SqliteOpFactoryCall[] = [];
  const bucketableCalls: SqliteOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketableCalls.push(...result.calls);
      }
    }
  }

  // Dependency-graph order: a topological sort over the issues' `dependsOn`
  // cross-links and containment edges (edge direction from the ordering law's
  // presence rule), path-tiebroken for determinism. `classifyCall` bucketing
  // downstream fixes the coarse create/recreate/drop sequence; this settles
  // the order within each bucket.
  const sorted = orderIssuesByDependencies(remaining);

  const defaultCalls: SqliteOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapNodeIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  // Policy gating for recipe + bucketable. Default-mapped calls for disallowed
  // classes never get here (they're surfaced as per-issue conflicts above).
  const allowed = policy.allowedOperationClasses;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketableCalls;
  let gatedDefault = defaultCalls;
  if (policyProvided) {
    const sink = (acc: SqliteOpFactoryCall[]) => (call: SqliteOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        acc.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedRecipeBucket: SqliteOpFactoryCall[] = [];
    const gatedBucketableBucket: SqliteOpFactoryCall[] = [];
    const gatedDefaultBucket: SqliteOpFactoryCall[] = [];
    recipeCalls.forEach(sink(gatedRecipeBucket));
    bucketableCalls.forEach(sink(gatedBucketableBucket));
    defaultCalls.forEach(sink(gatedDefaultBucket));
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
    gatedDefault = gatedDefaultBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  // Final emission order matches the current monolithic planner:
  //   create-table → add-column → create-index → recreate → drop-column → drop-index → drop-table
  const combined = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) => combined.filter((c) => classifyCall(c) === cat);

  const calls: SqliteOpFactoryCall[] = [
    ...byCategory('create-table'),
    ...byCategory('add-column'),
    ...byCategory('create-index'),
    ...gatedRecipe,
    ...byCategory('drop-column'),
    ...byCategory('drop-index'),
    ...byCategory('drop-table'),
  ];

  return ok({ calls });
}

function emptySchemaIR(): SqlSchemaIR {
  return new SqlSchemaIR({ tables: {} });
}

export function conflictForDisallowedCall(
  call: SqliteOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const summary = `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`;
  const location = locationForCall(call);
  return {
    kind: conflictKindForCall(call),
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function conflictKindForCall(call: SqliteOpFactoryCall): SqlPlannerConflict['kind'] {
  switch (call.factoryName) {
    case 'createIndex':
    case 'dropIndex':
      return 'indexIncompatible';
    default:
      return 'missingButNonAdditive';
  }
}

function locationForCall(call: SqliteOpFactoryCall): SqlPlannerConflictLocation | undefined {
  const location: { entityKind?: string; entityName?: string; column?: string; index?: string } =
    {};
  if ('tableName' in call) {
    location.entityKind = 'table';
    location.entityName = call.tableName;
  }
  if ('columnName' in call) location.column = call.columnName;
  if ('indexName' in call) location.index = call.indexName;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}
