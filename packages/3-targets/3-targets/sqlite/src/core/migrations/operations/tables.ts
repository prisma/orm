import type { MigrationOperationClass } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { RelationalSchemaNodeKind, type SqlColumnIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { tableExistsAst } from '../../../contract-free/checks';
import { stripOuterParens } from '../../default-normalizer';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { sqliteIdentifiersCollide } from '../identifier-case';
import { buildCreateIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import {
  type Op,
  renderColumnDefinition,
  renderForeignKeyClause,
  type SqliteIndexSpec,
  type SqliteTableSpec,
  step,
} from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function tableExistsSteps(
  lowerer: ExecuteRequestLowerer,
  tableName: string,
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = tableExistsAst(tableName);
  const present = await lowerer.lowerToExecuteRequest(checks.tablePresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.tableAbsent());
  return { present, absent };
}

/**
 * Renders the body of a `CREATE TABLE <name> ( … )` statement from a flat
 * `SqliteTableSpec`. SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` form is
 * inline on the column; the table-level PRIMARY KEY clause is emitted only
 * when no column carries `inlineAutoincrementPrimaryKey`.
 */
function renderCreateTableSql(tableName: string, spec: SqliteTableSpec): string {
  const columnDefs = spec.columns.map(renderColumnDefinition);

  const constraintDefs: string[] = [];
  const hasInlinePk = spec.columns.some((c) => c.inlineAutoincrementPrimaryKey);
  if (spec.primaryKey && !hasInlinePk) {
    constraintDefs.push(`PRIMARY KEY (${spec.primaryKey.columns.map(quoteIdentifier).join(', ')})`);
  }

  for (const u of spec.uniques ?? []) {
    const name = u.name ? `CONSTRAINT ${quoteIdentifier(u.name)} ` : '';
    constraintDefs.push(`${name}UNIQUE (${u.columns.map(quoteIdentifier).join(', ')})`);
  }

  for (const fk of spec.foreignKeys ?? []) {
    const clause = renderForeignKeyClause(fk);
    if (clause) constraintDefs.push(clause);
  }

  const allDefs = [...columnDefs, ...constraintDefs];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n  ${allDefs.join(',\n  ')}\n)`;
}

export async function createTable(
  tableName: string,
  spec: SqliteTableSpec,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { present, absent } = await tableExistsSteps(lowerer, tableName);
  return {
    id: `table.${tableName}`,
    label: `Create table ${tableName}`,
    summary: `Creates table ${tableName} with required columns`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [step(`ensure table "${tableName}" does not exist`, absent.sql, absent.params)],
    execute: [step(`create table "${tableName}"`, renderCreateTableSql(tableName, spec))],
    postcheck: [step(`verify table "${tableName}" exists`, present.sql, present.params)],
  };
}

export function renameTableViaName(toName: string): string {
  return `_prisma_rename_${toName}`;
}

export function renameChangesOnlyCase(fromName: string, toName: string): boolean {
  return sqliteIdentifiersCollide(fromName, toName);
}

/**
 * SQLite takes names that differ only in the case of ASCII letters for the
 * same name, so such a rename (`userProfile` to `UserProfile`) is refused as
 * "already exists" when done in one statement. It goes through a temporary name.
 */
export function renameTableSteps(fromName: string, toName: string): Op['execute'] {
  const from = quoteIdentifier(fromName);
  const to = quoteIdentifier(toName);
  if (!renameChangesOnlyCase(fromName, toName)) {
    return [
      step(`rename table "${fromName}" to "${toName}"`, `ALTER TABLE ${from} RENAME TO ${to}`),
    ];
  }
  const viaName = renameTableViaName(toName);
  const via = quoteIdentifier(viaName);
  return [
    step(
      `rename table "${fromName}" to "${viaName}" (SQLite table names are case-insensitive)`,
      `ALTER TABLE ${from} RENAME TO ${via}`,
    ),
    step(`rename table "${viaName}" to "${toName}"`, `ALTER TABLE ${via} RENAME TO ${to}`),
  ];
}

export async function dropTable(tableName: string, lowerer: ExecuteRequestLowerer): Promise<Op> {
  const { present, absent } = await tableExistsSteps(lowerer, tableName);
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table ${tableName}`,
    summary: `Drops table ${tableName} which is not in the contract`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [step(`ensure table "${tableName}" exists`, present.sql, present.params)],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${quoteIdentifier(tableName)}`)],
    postcheck: [step(`verify table "${tableName}" is gone`, absent.sql, absent.params)],
  };
}

export interface RecreateTableArgs {
  readonly tableName: string;
  /** New (post-recreate) shape of the table. Same flat spec as `createTable`. */
  readonly contractTable: SqliteTableSpec;
  /**
   * Names of columns that exist in the live (pre-recreate) schema. Used to
   * compute the `INSERT INTO temp ... SELECT ... FROM old` column list — only
   * shared columns are copied, so dropped columns are left behind and added
   * columns come from defaults.
   */
  readonly schemaColumnNames: readonly string[];
  /**
   * Indexes (declared + FK-backing, deduped by column-set) to recreate after
   * the table has been replaced. The planner pre-merges these.
   */
  readonly indexes: readonly SqliteIndexSpec[];
  /** Human-readable summary of the change, built by the planner from issues. */
  readonly summary: string;
  /**
   * Per-issue postcheck steps appended after the structural postchecks. The
   * planner pre-builds these via `buildRecreatePostchecks` so the call IR
   * carries flat, serializable data only — no `SchemaDiffIssue` references.
   */
  readonly postchecks: readonly { readonly description: string; readonly sql: string }[];
  readonly operationClass: MigrationOperationClass;
}

export async function recreateTable(
  args: RecreateTableArgs,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const {
    tableName,
    contractTable,
    schemaColumnNames,
    indexes,
    summary,
    postchecks,
    operationClass,
  } = args;
  const tempName = `_prisma_new_${tableName}`;
  const liveSet = new Set(schemaColumnNames);
  const sharedColumns = contractTable.columns.filter((c) => liveSet.has(c.name)).map((c) => c.name);
  const columnList = sharedColumns.map(quoteIdentifier).join(', ');

  const indexStatements = indexes.map((idx) => ({
    description: `recreate index "${idx.name}" on "${tableName}"`,
    sql: buildCreateIndexSql(tableName, idx.name, idx.columns),
  }));

  // If the contract retains no columns from the live table, an `INSERT INTO
  // tmp () SELECT FROM old` is invalid SQL — and would also be a no-op since
  // there's nothing to copy. Skip the copy step in that case; the new
  // (empty) table replaces the old one directly.
  const copyStep =
    sharedColumns.length > 0
      ? [
          step(
            `copy data from "${tableName}" to "${tempName}"`,
            `INSERT INTO ${quoteIdentifier(tempName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(tableName)}`,
          ),
        ]
      : [];

  const tableSteps = await tableExistsSteps(lowerer, tableName);
  const tempSteps = await tableExistsSteps(lowerer, tempName);

  return {
    id: `recreateTable.${tableName}`,
    label: `Recreate table ${tableName}`,
    summary,
    operationClass,
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [
      step(`ensure table "${tableName}" exists`, tableSteps.present.sql, tableSteps.present.params),
      step(
        `ensure temp table "${tempName}" does not exist`,
        tempSteps.absent.sql,
        tempSteps.absent.params,
      ),
    ],
    execute: [
      step(
        `create new table "${tempName}" with desired schema`,
        renderCreateTableSql(tempName, contractTable),
      ),
      ...copyStep,
      step(`drop old table "${tableName}"`, `DROP TABLE ${quoteIdentifier(tableName)}`),
      step(
        `rename "${tempName}" to "${tableName}"`,
        `ALTER TABLE ${quoteIdentifier(tempName)} RENAME TO ${quoteIdentifier(tableName)}`,
      ),
      ...indexStatements,
    ],
    postcheck: [
      step(`verify table "${tableName}" exists`, tableSteps.present.sql, tableSteps.present.params),
      step(
        `verify temp table "${tempName}" is gone`,
        tempSteps.absent.sql,
        tempSteps.absent.params,
      ),
      ...postchecks,
    ],
  };
}

/**
 * Build a one-line summary of a recreate-table operation from the schema-diff
 * issues that triggered it. Lives next to `recreateTable` so the planner
 * (which has the issues) can produce the same description the factory
 * used to build inline. Keeping the formatting target-side keeps
 * `RecreateTableCall` issue-free at the IR layer. `SchemaDiffIssue` carries
 * no rendered message, so this renders one from each issue's path.
 */
export function buildRecreateSummary(
  tableName: string,
  issues: readonly SchemaDiffIssue[],
): string {
  const messages = issues.map((i) => i.path.join('/')).join('; ');
  return `Recreates table ${tableName} to apply schema changes: ${messages}`;
}

function nodeKindOf(issue: SchemaDiffIssue): string | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<{ readonly nodeKind: string }, 'every diff-tree node declares nodeKind'>(node)
    .nodeKind;
}

/** Mirrors `SqlColumnIR.isEqualTo`'s type comparison, isolated so a `not-equal` column issue's postcheck can target type drift and nullability drift independently. */
function columnTypeChanged(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.resolvedNativeType !== undefined && actual.resolvedNativeType !== undefined) {
    return expected.resolvedNativeType !== actual.resolvedNativeType;
  }
  return (
    expected.nativeType !== actual.nativeType || Boolean(expected.many) !== Boolean(actual.many)
  );
}

/**
 * Returns the columns the contract expects as the table's primary key. Picks
 * up SQLite's inline `INTEGER PRIMARY KEY AUTOINCREMENT` form when no
 * explicit `primaryKey` clause is set on the spec.
 */
function expectedPrimaryKeyColumns(spec: SqliteTableSpec): readonly string[] {
  if (spec.primaryKey) return spec.primaryKey.columns;
  const inlinePk = spec.columns.find((c) => c.inlineAutoincrementPrimaryKey);
  return inlinePk ? [inlinePk.name] : [];
}

function quoteSqlList(values: readonly string[]): string {
  return values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
}

/**
 * A condition on the index aliased `l`: it covers exactly these columns. Order is not checked, because SQLite identifies a unique index by its column set.
 */
function indexCoversExactly(columns: readonly string[]): string {
  return (
    `(SELECT COUNT(*) FROM pragma_index_info(l.name)) = ${columns.length}` +
    ` AND (SELECT COUNT(*) FROM pragma_index_info(l.name) WHERE name IN (${quoteSqlList(columns)})) = ${columns.length}`
  );
}

function columnNameFromNode(issue: SchemaDiffIssue): string | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    { readonly name: string },
    'a column or column-default issue node carries name (default nodes read the owning column name off the diff path instead)'
  >(node).name;
}

/**
 * A column-default issue's own node has no back-reference to its owning
 * column — it's a transient child built by `SqlColumnIR.children()`. The
 * column's id (`column:<name>`) is always the diff path's second-to-last
 * segment for a default issue (`[..., tableId, columnId, 'default']`), so
 * the name is recovered from the path rather than the node.
 */
function columnNameFromDefaultIssuePath(issue: SchemaDiffIssue): string | undefined {
  const columnId = issue.path[issue.path.length - 2];
  if (columnId === undefined) return undefined;
  const prefix = 'column:';
  return columnId.startsWith(prefix) ? columnId.slice(prefix.length) : columnId;
}

/**
 * Per-issue postchecks verifying the recreated table's shape against the
 * expected spec. Column-level issues (`sql-column` `not-equal`,
 * `sql-column-default` any reason) emit one targeted check each;
 * constraint-level issues (`sql-primary-key`, `sql-unique`, `sql-foreign-key`,
 * any reason) emit one `pragma_*`-driven check per declared constraint in the
 * expected spec, so a recreated table with the right columns but the wrong
 * PK / unique / FK shape fails the postcheck instead of passing silently.
 * Exported so the planner can pre-build the list at construction time and
 * `RecreateTableCall` doesn't have to carry `SchemaDiffIssue` objects through
 * to render time.
 */
export function buildRecreatePostchecks(
  tableName: string,
  issues: readonly SchemaDiffIssue[],
  spec: SqliteTableSpec,
): Array<{ description: string; sql: string }> {
  const checks: Array<{ description: string; sql: string }> = [];
  const t = escapeLiteral(tableName);
  const byName = new Map(spec.columns.map((c) => [c.name, c]));

  let hasPkIssue = false;
  let hasUniqueIssue = false;
  let hasFkIssue = false;

  for (const issue of issues) {
    const nodeKind = nodeKindOf(issue);
    if (nodeKind === RelationalSchemaNodeKind.column && issueOutcome(issue) === 'not-equal') {
      const columnName = columnNameFromNode(issue);
      if (columnName === undefined) continue;
      const c = escapeLiteral(columnName);
      const expected = blindCast<SqlColumnIR, 'a not-equal column issue carries the expected node'>(
        issue.expected,
      );
      const actual = blindCast<SqlColumnIR, 'a not-equal column issue carries the actual node'>(
        issue.actual,
      );
      if (expected.nullable !== actual.nullable) {
        checks.push({
          description: `verify "${columnName}" nullability on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND "notnull" = ${expected.nullable ? 0 : 1}`,
        });
      }
      if (columnTypeChanged(expected, actual)) {
        const colSpec = byName.get(columnName);
        if (colSpec) {
          checks.push({
            description: `verify "${columnName}" type on "${tableName}"`,
            sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND LOWER(type) = '${escapeLiteral(colSpec.typeSql.toLowerCase())}'`,
          });
        }
      }
      continue;
    }
    if (nodeKind === RelationalSchemaNodeKind.columnDefault) {
      const columnName = columnNameFromDefaultIssuePath(issue);
      if (columnName === undefined) continue;
      const c = escapeLiteral(columnName);
      if (issueOutcome(issue) === 'not-expected') {
        checks.push({
          description: `verify "${columnName}" has no default on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value IS NULL`,
        });
        continue;
      }
      // not-found (missing) or not-equal (drift) — both want the expected
      // default SQL present on the live column.
      const colSpec = byName.get(columnName);
      const expectedRaw = colSpec?.defaultSql.startsWith('DEFAULT ')
        ? // SQLite's pragma_table_info.dflt_value strips outer parens for
          // expression defaults (per the SQLite docs), so `(datetime('now'))`
          // is stored as `datetime('now')`. Strip them here so the postcheck
          // matches.
          stripOuterParens(colSpec.defaultSql.slice('DEFAULT '.length))
        : null;
      if (expectedRaw) {
        checks.push({
          description: `verify "${columnName}" default on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value = '${escapeLiteral(expectedRaw)}'`,
        });
      }
      continue;
    }
    if (nodeKind === RelationalSchemaNodeKind.primaryKey) hasPkIssue = true;
    if (nodeKind === RelationalSchemaNodeKind.unique) hasUniqueIssue = true;
    if (nodeKind === RelationalSchemaNodeKind.foreignKey) hasFkIssue = true;
  }

  // Constraint-level issues — emit one postcheck per declared constraint in
  // the expected spec when *any* issue of that kind fires, since recreate
  // rebuilds the entire table at once.

  if (hasPkIssue) {
    const pkColumns = expectedPrimaryKeyColumns(spec);
    // Verify pragma_table_info reports exactly these columns as PK members
    // (count + named membership); zero columns expected ⇒ no PK at all.
    const colCount = pkColumns.length;
    if (colCount === 0) {
      checks.push({
        description: `verify "${tableName}" has no primary key`,
        sql: `SELECT (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0) = 0`,
      });
    } else {
      checks.push({
        description: `verify primary key on "${tableName}"`,
        sql:
          `SELECT (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0) = ${colCount}` +
          ` AND (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0 AND name IN (${quoteSqlList(pkColumns)})) = ${colCount}`,
      });
    }
  }

  if (hasUniqueIssue) {
    for (const u of spec.uniques ?? []) {
      const description = u.name
        ? `verify unique constraint "${u.name}" on "${tableName}"`
        : `verify unique constraint (${u.columns.join(', ')}) on "${tableName}"`;
      checks.push({
        description,
        sql:
          `SELECT EXISTS (SELECT 1 FROM pragma_index_list('${t}') l` +
          ` WHERE l."unique" = 1 AND ${indexCoversExactly(u.columns)})`,
      });
    }
  }

  // The checks above only prove expected uniques exist, so removing one would
  // leave the postcheck already true and the runner would skip the recreate.
  // This check fails while a UNIQUE constraint index (`origin = 'u'`) matches
  // no expected unique. It does not count indexes: SQLite folds a unique that
  // repeats a non-integer primary key into the primary key's index.
  if (hasUniqueIssue) {
    const expected = (spec.uniques ?? []).map((u) => `(${indexCoversExactly(u.columns)})`);
    checks.push({
      description: `verify "${tableName}" has no unique constraint besides the expected ones`,
      sql:
        `SELECT NOT EXISTS (SELECT 1 FROM pragma_index_list('${t}') l` +
        ` WHERE l.origin = 'u' AND NOT (${expected.length === 0 ? '0' : expected.join(' OR ')}))`,
    });
  }

  if (hasFkIssue) {
    for (const fk of spec.foreignKeys ?? []) {
      const refTable = escapeLiteral(fk.references.table);
      const colCount = fk.columns.length;
      // Build a `SUM(CASE WHEN ("from","to") IN ((…)) …)` so the check works
      // for both single- and multi-column FKs without depending on FK row
      // ordering inside `pragma_foreign_key_list`.
      const tuples = fk.columns
        .map((from, i) => {
          const to = fk.references.columns[i] ?? from;
          return `('${escapeLiteral(from)}', '${escapeLiteral(to)}')`;
        })
        .join(', ');
      const description = `verify foreign key (${fk.columns.join(', ')}) → ${fk.references.table}(${fk.references.columns.join(', ')}) on "${tableName}"`;
      checks.push({
        description,
        sql:
          `SELECT EXISTS (SELECT 1 FROM pragma_foreign_key_list('${t}') f` +
          ` WHERE f."table" = '${refTable}'` +
          ' GROUP BY f.id' +
          ` HAVING COUNT(*) = ${colCount}` +
          ` AND SUM(CASE WHEN (f."from", f."to") IN (${tuples}) THEN 1 ELSE 0 END) = ${colCount})`,
      });
    }
    const expected = spec.foreignKeys?.length ?? 0;
    checks.push({
      description: `verify "${tableName}" has exactly ${expected} foreign keys`,
      sql: `SELECT (SELECT COUNT(DISTINCT id) FROM pragma_foreign_key_list('${t}')) = ${expected}`,
    });
  }

  return checks;
}
