import {
  convertedColumnMeta,
  type MigrationOperationClass,
  requiredColumnMeta,
  type SqlMigrationPlanOperationStep,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { RowsWithoutValue, SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { isSqlDataType, nameIsCatalogText } from '@internal/sql-contract/data-type';
import { REFERENTIAL_ACTION_SQL } from '@internal/sql-contract/referential-action-sql';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { RelationalSchemaNodeKind, type SqlColumnIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { type } from 'arktype';
import { tableExistsAst } from '../../../contract-free/checks';
import { stripOuterParens } from '../../default-normalizer';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { sqliteIdentifiersCollide } from '../identifier-case';
import { buildCreateIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import {
  type Op,
  refuseEarlierColumnSpecs,
  renderColumnDefinition,
  renderForeignKeyClause,
  renderSpecDefault,
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
function renderCreateTableSql(
  tableName: string,
  spec: SqliteTableSpec,
  defaultClauses: readonly string[],
): string {
  const columnDefs = spec.columns.map((column, index) =>
    renderColumnDefinition(column, defaultClauses[index] ?? ''),
  );

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
  const defaultClauses = await renderSpecDefaults(spec, tableName, lowerer);
  const { present, absent } = await tableExistsSteps(lowerer, tableName);
  return {
    id: `table.${tableName}`,
    label: `Create table ${tableName}`,
    summary: `Creates table ${tableName} with required columns`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [step(`ensure table "${tableName}" does not exist`, absent.sql, absent.params)],
    execute: [
      step(`create table "${tableName}"`, renderCreateTableSql(tableName, spec, defaultClauses)),
    ],
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
  readonly postchecks: readonly RecreatePostcheck[];
  readonly operationClass: MigrationOperationClass;
  /**
   * The conversion each named column of the new table is copied through, in place of the live
   * column of the same name, keyed by the new table's column names. The rebuild checks after its
   * copy that every value of each such column took the column's type, and a failure of the copy or
   * the check is reported as a failed conversion of the column's field.
   */
  readonly copyExpressions?: Readonly<Record<string, string>>;
  /**
   * The value each named column the live table does not have takes in the existing rows, keyed by
   * the new table's column names. It is copied like a copy expression, with no check of its own.
   */
  readonly temporaryValues?: Readonly<Record<string, string>>;
  /**
   * The columns whose type changes. The rebuild checks after its copy that every value of each took
   * the new type: a column with a copy expression as a conversion, and one the copy takes unchanged,
   * for SQLite's type affinity to convert, as a cast.
   */
  readonly retypedColumns?: readonly string[];
}

/** The table a rebuild of `tableName` creates, copies into, and renames to `tableName`. */
export function rebuiltTableName(tableName: string): string {
  return `_prisma_new_${tableName}`;
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
    copyExpressions = {},
    temporaryValues = {},
    retypedColumns = [],
  } = args;
  refuseEarlierColumnSpecs('recreateTable', tableName, contractTable.columns);
  const tempName = rebuiltTableName(tableName);
  const liveSet = new Set(schemaColumnNames);
  const convertedBy = (column: string): string | undefined =>
    Object.hasOwn(copyExpressions, column) ? copyExpressions[column] : undefined;
  const copiedFrom = (column: string): string | undefined =>
    convertedBy(column) ??
    (Object.hasOwn(temporaryValues, column) ? temporaryValues[column] : undefined);
  const sharedColumns = contractTable.columns
    .filter((c) => liveSet.has(c.name) || copiedFrom(c.name) !== undefined)
    .map((c) => c.name);
  const columnList = sharedColumns.map(quoteIdentifier).join(', ');
  const selectList = sharedColumns
    .map((column) => copiedFrom(column) ?? quoteIdentifier(column))
    .join(', ');

  const indexStatements = indexes.map((idx) => ({
    description: `recreate index "${idx.name}" on "${tableName}"`,
    sql: buildCreateIndexSql(tableName, idx.name, idx.columns),
  }));

  // If the contract retains no columns from the live table, an `INSERT INTO
  // tmp () SELECT FROM old` is invalid SQL — and would also be a no-op since
  // there's nothing to copy. Skip the copy step in that case; the new
  // (empty) table replaces the old one directly.
  const conversions = Object.fromEntries(
    sharedColumns.flatMap((column) => {
      const expression = convertedBy(column);
      return expression === undefined ? [] : [[column, expression] as const];
    }),
  );
  const copyStep =
    sharedColumns.length > 0
      ? [
          {
            ...step(
              `copy data from "${tableName}" to "${tempName}"`,
              `INSERT INTO ${quoteIdentifier(tempName)} (${columnList}) SELECT ${selectList} FROM ${quoteIdentifier(tableName)}`,
            ),
            ...(Object.keys(conversions).length === 0
              ? {}
              : { meta: { conversionCopy: { table: tableName, expressions: conversions } } }),
          },
        ]
      : [];

  const defaultClauses = await renderSpecDefaults(contractTable, tableName, lowerer);
  const clauseByColumn = new Map(
    contractTable.columns.map((column, index) => [column.name, defaultClauses[index] ?? '']),
  );
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
      sourceColumnsCheck(tableName, schemaColumnNames),
    ],
    execute: [
      step(
        `create new table "${tempName}" with desired schema`,
        renderCreateTableSql(tempName, contractTable, defaultClauses),
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
      rebuiltTableCheck(tableName, renderCreateTableSql(tableName, contractTable, defaultClauses)),
      ...postchecks.flatMap((check) =>
        'sql' in check
          ? [markedStep(tableName, check)]
          : defaultPostcheck(tableName, check, clauseByColumn.get(check.columnDefault)),
      ),
      ...contractTable.columns.flatMap((column) => {
        const by = Object.hasOwn(conversions, column.name)
          ? ('conversion' as const)
          : retypedColumns.includes(column.name)
            ? ('cast' as const)
            : undefined;
        return by === undefined
          ? []
          : [
              {
                ...storageClassCheck(tableName, column),
                meta: convertedColumnMeta(tableName, column.name, by),
              },
            ];
      }),
    ],
  };
}

/**
 * Checks that the table has exactly the columns the rebuild reads, the ones it copies and the ones it
 * leaves out. The rebuild copies only the columns it knows, so on a table with another column, such
 * as one a later migration added, it would drop that column and its values.
 */
function sourceColumnsCheck(
  tableName: string,
  columns: readonly string[],
): SqlMigrationPlanOperationStep {
  const info = `pragma_table_info('${escapeLiteral(tableName)}')`;
  const named =
    columns.length === 0
      ? ''
      : ` AND (SELECT COUNT(*) FROM ${info} WHERE name IN (${quoteSqlList(columns)})) = ${columns.length}`;
  return {
    description: `ensure table "${tableName}" has exactly the columns the rebuild copies or leaves out (${columns.join(', ')})`,
    sql: `SELECT (SELECT COUNT(*) FROM ${info}) = ${columns.length}${named}`,
  };
}

/**
 * Checks that the table is stored as the statement the rebuild writes. SQLite keeps a table's
 * `CREATE TABLE` text as written, and renaming the rebuilt table only replaces its name, so this holds
 * once the rebuild ran and not before, whatever text an earlier table had. It is the only check of
 * what SQLite keeps in that text alone, such as `AUTOINCREMENT`.
 */
function rebuiltTableCheck(tableName: string, statement: string): SqlMigrationPlanOperationStep {
  return {
    description: `verify "${tableName}" is stored as the rebuilt table`,
    sql: `SELECT (SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}') = '${escapeLiteral(statement)}'`,
  };
}

/** A column the rebuild makes required: one that held NULL before, or a new one the copy gives no value. */
export interface RecreateRequiredColumn {
  readonly column: string;
  readonly reason: RowsWithoutValue['reason'];
}

/** A recreate postcheck written as SQL. */
export interface RecreateSqlPostcheck {
  readonly description: string;
  readonly sql: string;
  /** The column the check finds required; when the copy fails on it, the runner counts its rows. */
  readonly requiredColumn?: RecreateRequiredColumn;
}

/**
 * A recreate postcheck: SQL, or the name of a column whose default the recreated table must carry,
 * which becomes SQL once the adapter has written the column's `DEFAULT …` clause.
 */
export type RecreatePostcheck =
  | RecreateSqlPostcheck
  | { readonly description: string; readonly columnDefault: string };

function markedStep(tableName: string, check: RecreateSqlPostcheck): SqlMigrationPlanOperationStep {
  const { requiredColumn, ...step } = check;
  const meta = {
    ...(requiredColumn === undefined
      ? {}
      : requiredColumnMeta(tableName, requiredColumn.column, requiredColumn.reason)),
  };
  return Object.keys(meta).length === 0 ? step : { ...step, meta };
}

/**
 * The storage classes SQLite keeps a value in once a column of `typeSql` has taken it: the column's
 * type affinity converts what it can, so a value of another class is one it could not convert.
 * See https://www.sqlite.org/datatype3.html#determination_of_column_affinity.
 */
export function affinityStorageClasses(typeSql: string): readonly string[] {
  const declared = typeSql.toUpperCase();
  if (declared.includes('INT')) return ['integer'];
  if (['CHAR', 'CLOB', 'TEXT'].some((part) => declared.includes(part))) return ['text'];
  if (declared === '' || declared.includes('BLOB')) return ['blob'];
  if (['REAL', 'FLOA', 'DOUB'].some((part) => declared.includes(part))) return ['real'];
  return ['integer', 'real'];
}

/**
 * The check that the copy into a rebuilt table converted every value of a retyped column to the
 * column's new type. SQLite keeps a value it cannot convert in its old storage class, so a value of
 * any other class than the column's affinity keeps fails the check.
 */
export function storageClassCheck(
  tableName: string,
  column: { readonly name: string; readonly typeSql: string },
): { readonly description: string; readonly sql: string } {
  const classes = ['null', ...affinityStorageClasses(column.typeSql)]
    .map((storageClass) => `'${storageClass}'`)
    .join(', ');
  return {
    description: `verify every value of "${column.name}" on "${tableName}" is stored as ${column.typeSql}`,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE typeof(${quoteIdentifier(column.name)}) NOT IN (${classes}))`,
  };
}

const ConversionCopyMeta = type({
  conversionCopy: { table: 'string', expressions: 'Record<string, string>' },
});

/**
 * The table a rebuild's copy step reads and the copy expression of each column its conversions
 * convert, when the step converts any: an error of the step may be an error of one of them.
 */
export function conversionCopyOf(
  step: SqlMigrationPlanOperationStep,
): { readonly table: string; readonly expressions: Readonly<Record<string, string>> } | undefined {
  const meta = ConversionCopyMeta(step.meta ?? {});
  return meta instanceof type.errors ? undefined : meta.conversionCopy;
}

function renderSpecDefaults(
  spec: SqliteTableSpec,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<readonly string[]> {
  return Promise.all(spec.columns.map((column) => renderSpecDefault(column, tableName, lowerer)));
}

/**
 * Checks the column's default is the text of its `DEFAULT …` clause. SQLite's
 * `pragma_table_info.dflt_value` strips the outer parentheses of an expression
 * default, so `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` is stored as `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; they are
 * stripped here too.
 */
function defaultPostcheck(
  tableName: string,
  check: { readonly description: string; readonly columnDefault: string },
  clause: string | undefined,
): { description: string; sql: string }[] {
  if (clause === undefined || !clause.startsWith('DEFAULT ')) return [];
  const expectedRaw = stripOuterParens(clause.slice('DEFAULT '.length));
  return [
    {
      description: check.description,
      sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${escapeLiteral(tableName)}') WHERE name = '${escapeLiteral(check.columnDefault)}' AND dflt_value = '${escapeLiteral(expectedRaw)}'`,
    },
  ];
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

/** The text `pragma_foreign_key_list` reports for a referential action; SQLite reads an absent action as `NO ACTION`. */
function referentialActionText(action: ReferentialAction | undefined): string {
  return REFERENTIAL_ACTION_SQL[action ?? 'noAction'];
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
 * Compares the declared type with `typeSql`: exactly for a data type named by its catalog text, as
 * verify compares it (ADR 273), and without case otherwise.
 */
function declaredTypeMatches(expected: SqlColumnIR, typeSql: string): string {
  const { dataType } = expected;
  return dataType !== undefined && isSqlDataType(dataType) && nameIsCatalogText(dataType)
    ? `type = '${escapeLiteral(typeSql)}'`
    : `LOWER(type) = '${escapeLiteral(typeSql.toLowerCase())}'`;
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
  copiedColumns: ReadonlySet<string> = new Set(),
  backfilledColumns: ReadonlySet<string> = new Set(),
): RecreatePostcheck[] {
  const checks: RecreatePostcheck[] = [];
  const t = escapeLiteral(tableName);
  const byName = new Map(spec.columns.map((c) => [c.name, c]));

  let hasPkIssue = false;
  let hasUniqueIssue = false;
  let hasFkIssue = false;

  for (const issue of issues) {
    const nodeKind = nodeKindOf(issue);
    if (nodeKind === RelationalSchemaNodeKind.column && issueOutcome(issue) === 'not-found') {
      const columnName = columnNameFromNode(issue);
      const column = columnName === undefined ? undefined : byName.get(columnName);
      if (columnName === undefined || column === undefined) continue;
      const takesNoValue =
        !column.nullable && column.default === undefined && !copiedColumns.has(columnName);
      checks.push({
        description: `verify "${columnName}" nullability on "${tableName}"`,
        sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${escapeLiteral(columnName)}' AND "notnull" = ${column.nullable ? 0 : 1}`,
        ...(backfilledColumns.has(columnName)
          ? { requiredColumn: { column: columnName, reason: 'backfillMissedRows' } }
          : takesNoValue
            ? { requiredColumn: { column: columnName, reason: 'newField' } }
            : {}),
      });
      continue;
    }
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
          ...(expected.nullable
            ? {}
            : {
                requiredColumn: {
                  column: columnName,
                  reason: backfilledColumns.has(columnName) ? 'backfillMissedRows' : 'nullValues',
                },
              }),
        });
      }
      if (expected.typeDiffersFrom(actual)) {
        const colSpec = byName.get(columnName);
        if (colSpec) {
          checks.push({
            description: `verify "${columnName}" type on "${tableName}"`,
            sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND ${declaredTypeMatches(expected, colSpec.typeSql)}`,
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
      // default present on the live column, as the adapter writes it.
      if (byName.get(columnName)?.default !== undefined) {
        checks.push({
          description: `verify "${columnName}" default on "${tableName}"`,
          columnDefault: columnName,
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
          ` AND f.on_delete = '${referentialActionText(fk.onDelete)}'` +
          ` AND f.on_update = '${referentialActionText(fk.onUpdate)}'` +
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
