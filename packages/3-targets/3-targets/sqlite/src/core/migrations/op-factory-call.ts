/**
 * SQLite migration IR: one concrete `*Call` class per pure factory under
 * `operations/`, plus a shared `SqliteOpFactoryCallNode` abstract base.
 *
 * Each call class carries fully-resolved literal arguments. `CreateTableCall`
 * holds structured `DdlColumn[]` + `DdlTableConstraint[]` and lowers via the
 * adapter's DDL path; other call classes carry flat SQL fragments. Codec /
 * `typeRef` / default expansion happens upstream in the issue-planner /
 * strategies, mirroring the Postgres `ColumnSpec` pattern.
 */

import { errorUnfilledPlaceholder } from '@internal/errors/migration';
import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer, Lowerer } from '@internal/family-sql/control-adapter';
import type { OpFactoryCall as FrameworkOpFactoryCall } from '@internal/framework-components/control';
import type {
  AnyDdlColumnDefault,
  DdlColumn,
  DdlTableConstraint,
} from '@internal/sql-relational-core/ast';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@internal/ts-render';
import { ifDefined } from '@internal/utils/defined';
import { columnExistsAst, indexExistsAst, tableExistsAst } from '../../contract-free/checks';
import * as contractFreeDdl from '../../contract-free/ddl';
import { sqliteError } from '../errors';
import { quoteIdentifier } from '../sql-utils';
import { addColumnExecuteSql, dropColumnExecuteSql } from './operations/columns';
import type { SqliteColumnSpec, SqliteIndexSpec, SqliteTableSpec } from './operations/shared';
import { step } from './operations/shared';
import {
  recreateTable,
  renameChangesOnlyCase,
  renameTableSteps,
  renameTableViaName,
} from './operations/tables';
import { buildCreateIndexSql, buildDropIndexSql } from './planner-ddl-builders';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import { buildTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

// The authored name. `render-typescript.ts` maps it to whatever the consuming
// application's import root calls it, once over the whole assembled import
// list.
const TARGET_MIGRATION_MODULE = '@internal/sqlite/migration';

abstract class SqliteOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(lowerer?: Lowerer): Op | Promise<Op>;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

// ============================================================================
// Table
// ============================================================================

// ---------------------------------------------------------------------------
// TypeScript rendering helpers for DdlColumn / DdlTableConstraint
// ---------------------------------------------------------------------------

function renderDdlColumnDefault(def: AnyDdlColumnDefault | undefined): string {
  if (!def) return '';
  if (def.kind === 'literal') {
    return `lit(${jsonToTsSource(def.value)})`;
  }
  return `fn(${jsonToTsSource(def.expression)})`;
}

function renderDdlColumnAsTsCall(column: DdlColumn): string {
  const opts: string[] = [];
  if (column.notNull) opts.push('notNull: true');
  if (column.primaryKey) opts.push('primaryKey: true');
  if (column.default) opts.push(`default: ${renderDdlColumnDefault(column.default)}`);
  const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
  return `col(${jsonToTsSource(column.name)}, ${jsonToTsSource(column.type)}${optsStr})`;
}

function renderDdlConstraintAsTsCall(constraint: DdlTableConstraint): string {
  switch (constraint.kind) {
    case 'primary-key': {
      const nameOpt = constraint.name ? `, { name: ${jsonToTsSource(constraint.name)} }` : '';
      return `primaryKey(${jsonToTsSource(constraint.columns)}${nameOpt})`;
    }
    case 'foreign-key': {
      const opts: string[] = [];
      if (constraint.name) opts.push(`name: ${jsonToTsSource(constraint.name)}`);
      if (constraint.onDelete) opts.push(`onDelete: ${jsonToTsSource(constraint.onDelete)}`);
      if (constraint.onUpdate) opts.push(`onUpdate: ${jsonToTsSource(constraint.onUpdate)}`);
      const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
      return `foreignKey(${jsonToTsSource(constraint.columns)}, ${jsonToTsSource(constraint.refTable)}, ${jsonToTsSource(constraint.refColumns)}${optsStr})`;
    }
    case 'unique': {
      const nameOpt = constraint.name ? `, { name: ${jsonToTsSource(constraint.name)} }` : '';
      return `unique(${jsonToTsSource(constraint.columns)}${nameOpt})`;
    }
    case 'check-expression':
      throw sqliteError(
        'CONTRACT.CONSTRAINT_INVALID',
        `The SQLite target does not support CHECK constraints (constraint "${constraint.name}"). The "checkConstraint" capability is Postgres-only — remove the "@@check" / "check()" declaration, or target Postgres.`,
        { meta: { constraintName: constraint.name } },
      );
  }
}

function constraintImportSymbols(constraints: readonly DdlTableConstraint[] | undefined): string[] {
  if (!constraints || constraints.length === 0) return [];
  const symbols = new Set<string>();
  for (const c of constraints) {
    if (c.kind === 'primary-key') symbols.add('primaryKey');
    else if (c.kind === 'foreign-key') symbols.add('foreignKey');
    else if (c.kind === 'unique') symbols.add('unique');
  }
  return [...symbols];
}

function defaultImportSymbols(columns: readonly DdlColumn[]): string[] {
  const symbols = new Set<string>();
  for (const col of columns) {
    if (col.default?.kind === 'literal') symbols.add('lit');
    else if (col.default?.kind === 'function') symbols.add('fn');
  }
  return [...symbols];
}

export class CreateTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly columns: readonly DdlColumn[];
  readonly constraints: readonly DdlTableConstraint[] | undefined;
  readonly label: string;

  constructor(
    tableName: string,
    columns: readonly DdlColumn[],
    constraints?: readonly DdlTableConstraint[],
  ) {
    super();
    this.tableName = tableName;
    this.columns = Object.freeze([...columns]);
    this.constraints = constraints ? Object.freeze([...constraints]) : undefined;
    this.label = `Create table ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `CreateTableCall.toOp: a DDL lowerer is required on the SQLite planner path (table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        { meta: { factory: this.factoryName, tableName: this.tableName } },
      );
    }
    const ddlNode = contractFreeDdl.createTable({
      table: this.tableName,
      columns: this.columns,
      ...ifDefined('constraints', this.constraints),
    });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const tableName = this.tableName;
    const tableChecks = tableExistsAst(tableName);
    const absent = await lowerer.lowerToExecuteRequest(tableChecks.tableAbsent());
    const present = await lowerer.lowerToExecuteRequest(tableChecks.tablePresent());
    return {
      id: `table.${tableName}`,
      label: `Create table ${tableName}`,
      summary: `Creates table ${tableName} with required columns`,
      operationClass: 'additive',
      target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
      precheck: [step(`ensure table "${tableName}" does not exist`, absent.sql, absent.params)],
      execute: [
        {
          description: `create table "${tableName}"`,
          sql: statement.sql,
          params: statement.params ?? [],
        },
      ],
      postcheck: [step(`verify table "${tableName}" exists`, present.sql, present.params)],
    };
  }

  renderTypeScript(): string {
    const columnsList = this.columns.map(renderDdlColumnAsTsCall).join(', ');
    const constraintsList = this.constraints
      ? this.constraints.map(renderDdlConstraintAsTsCall).join(', ')
      : undefined;

    const opts: string[] = [];
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`columns: [${columnsList}]`);
    if (constraintsList) opts.push(`constraints: [${constraintsList}]`);

    return `this.createTable({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [];
    if (this.columns.length > 0) {
      req.push({ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: 'col' });
      for (const sym of defaultImportSymbols(this.columns)) {
        req.push({ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: sym });
      }
    }
    for (const sym of constraintImportSymbols(this.constraints)) {
      req.push({ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: sym });
    }
    return req;
  }
}

export class DropTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropTable' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly label: string;

  constructor(tableName: string) {
    super();
    this.tableName = tableName;
    this.label = `Drop table ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `DropTableCall.toOp: a lowerer is required on the SQLite planner path (table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        { meta: { factory: this.factoryName, tableName: this.tableName } },
      );
    }
    const checks = tableExistsAst(this.tableName);
    const present = await lowerer.lowerToExecuteRequest(checks.tablePresent());
    const absent = await lowerer.lowerToExecuteRequest(checks.tableAbsent());
    return {
      id: `dropTable.${this.tableName}`,
      label: `Drop table ${this.tableName}`,
      summary: `Drops table ${this.tableName} which is not in the contract`,
      operationClass: 'destructive',
      target: { id: 'sqlite', details: buildTargetDetails('table', this.tableName) },
      precheck: [step(`ensure table "${this.tableName}" exists`, present.sql, present.params)],
      execute: [
        step(`drop table "${this.tableName}"`, `DROP TABLE ${quoteIdentifier(this.tableName)}`),
      ],
      postcheck: [step(`verify table "${this.tableName}" is gone`, absent.sql, absent.params)],
    };
  }

  renderTypeScript(): string {
    return `this.dropTable({ table: ${jsonToTsSource(this.tableName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenameTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'renameTable' as const;
  // `widening`: a rename is neither additive creation nor destructive, and the
  // class vocabulary has no neutral middle class, so this is the class that
  // plans under every allowance set except additive-only init.
  readonly operationClass = 'widening' as const;
  readonly oldTableName: string;
  /** The new name: the table's contract-side identity after the rename. */
  readonly tableName: string;
  readonly label: string;

  constructor(oldTableName: string, tableName: string) {
    super();
    this.oldTableName = oldTableName;
    this.tableName = tableName;
    this.label = `Rename table ${oldTableName} to ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `RenameTableCall.toOp: a lowerer is required on the SQLite planner path (table "${this.oldTableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        { meta: { factory: this.factoryName, tableName: this.oldTableName } },
      );
    }
    const fromChecks = tableExistsAst(this.oldTableName);
    const toChecks = tableExistsAst(this.tableName);
    const fromPresent = await lowerer.lowerToExecuteRequest(fromChecks.tablePresent());
    const toAbsent = await lowerer.lowerToExecuteRequest(toChecks.tableAbsent());
    const viaName = renameTableViaName(this.tableName);
    const viaAbsent = renameChangesOnlyCase(this.oldTableName, this.tableName)
      ? await lowerer.lowerToExecuteRequest(tableExistsAst(viaName).tableAbsent())
      : undefined;
    const toPresent = await lowerer.lowerToExecuteRequest(toChecks.tablePresent());
    const fromAbsent = await lowerer.lowerToExecuteRequest(fromChecks.tableAbsent());
    return {
      id: `renameTable.${this.oldTableName}`,
      label: this.label,
      summary: `Renames table ${this.oldTableName} to ${this.tableName}, keeping its rows`,
      operationClass: 'widening',
      target: { id: 'sqlite', details: buildTargetDetails('table', this.tableName) },
      precheck: [
        step(`ensure table "${this.oldTableName}" exists`, fromPresent.sql, fromPresent.params),
        step(`ensure table "${this.tableName}" does not exist`, toAbsent.sql, toAbsent.params),
        ...(viaAbsent === undefined
          ? []
          : [
              step(
                `ensure table "${viaName}" does not exist (a rename that only changes case passes through this temporary name, because SQLite compares table names without case)`,
                viaAbsent.sql,
                viaAbsent.params,
              ),
            ]),
      ],
      execute: renameTableSteps(this.oldTableName, this.tableName),
      // Both postchecks: the runner skips an operation whose postcheck
      // already holds, and "the new table exists" alone would skip a rename
      // that never happened when both tables exist.
      postcheck: [
        step(`verify table "${this.tableName}" exists`, toPresent.sql, toPresent.params),
        step(
          `verify table "${this.oldTableName}" no longer exists`,
          fromAbsent.sql,
          fromAbsent.params,
        ),
      ],
    };
  }

  renderTypeScript(): string {
    return `...this.renameTable({ table: ${jsonToTsSource(this.oldTableName)}, to: ${jsonToTsSource(this.tableName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RecreateTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'recreateTable' as const;
  readonly operationClass: MigrationOperationClass;
  readonly tableName: string;
  readonly contractTable: SqliteTableSpec;
  readonly schemaColumnNames: readonly string[];
  readonly indexes: readonly SqliteIndexSpec[];
  readonly summary: string;
  readonly postchecks: readonly { readonly description: string; readonly sql: string }[];
  readonly label: string;

  constructor(args: {
    tableName: string;
    contractTable: SqliteTableSpec;
    schemaColumnNames: readonly string[];
    indexes: readonly SqliteIndexSpec[];
    summary: string;
    postchecks: readonly { readonly description: string; readonly sql: string }[];
    operationClass: MigrationOperationClass;
  }) {
    super();
    this.tableName = args.tableName;
    this.contractTable = args.contractTable;
    this.schemaColumnNames = args.schemaColumnNames;
    this.indexes = args.indexes;
    this.summary = args.summary;
    this.postchecks = args.postchecks;
    this.operationClass = args.operationClass;
    this.label = `Recreate table ${args.tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `RecreateTableCall.toOp: a lowerer is required on the SQLite planner path (table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        { meta: { factory: this.factoryName, tableName: this.tableName } },
      );
    }
    return recreateTable(
      {
        tableName: this.tableName,
        contractTable: this.contractTable,
        schemaColumnNames: this.schemaColumnNames,
        indexes: this.indexes,
        summary: this.summary,
        postchecks: this.postchecks,
        operationClass: this.operationClass,
      },
      lowerer,
    );
  }

  renderTypeScript(): string {
    const args = {
      tableName: this.tableName,
      contractTable: this.contractTable,
      schemaColumnNames: this.schemaColumnNames,
      indexes: this.indexes,
      summary: this.summary,
      postchecks: this.postchecks,
      operationClass: this.operationClass,
    };
    return `this.recreateTable(${jsonToTsSource(args)})`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Column
// ============================================================================

export class AddColumnCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'addColumn' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: SqliteColumnSpec;
  readonly label: string;

  constructor(tableName: string, column: SqliteColumnSpec) {
    super();
    this.tableName = tableName;
    this.columnName = column.name;
    this.column = column;
    this.label = `Add column ${column.name} on ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `AddColumnCall.toOp: a lowerer is required on the SQLite planner path (column "${this.column.name}" on table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        {
          meta: {
            factory: this.factoryName,
            tableName: this.tableName,
            columnName: this.column.name,
          },
        },
      );
    }
    const checks = columnExistsAst(this.tableName, this.column.name);
    const absent = await lowerer.lowerToExecuteRequest(checks.columnAbsent());
    const present = await lowerer.lowerToExecuteRequest(checks.columnPresent());
    return {
      id: `column.${this.tableName}.${this.column.name}`,
      label: `Add column ${this.column.name} on ${this.tableName}`,
      summary: `Adds column ${this.column.name} on ${this.tableName}`,
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: buildTargetDetails('column', this.column.name, this.tableName),
      },
      precheck: [step(`ensure column "${this.column.name}" is missing`, absent.sql, absent.params)],
      execute: [
        step(`add column "${this.column.name}"`, addColumnExecuteSql(this.tableName, this.column)),
      ],
      postcheck: [step(`verify column "${this.column.name}" exists`, present.sql, present.params)],
    };
  }

  renderTypeScript(): string {
    return `this.addColumn({ table: ${jsonToTsSource(this.tableName)}, column: ${jsonToTsSource(this.column)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropColumnCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropColumn' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(tableName: string, columnName: string) {
    super();
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop column ${columnName} on ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `DropColumnCall.toOp: a lowerer is required on the SQLite planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        {
          meta: {
            factory: this.factoryName,
            tableName: this.tableName,
            columnName: this.columnName,
          },
        },
      );
    }
    const checks = columnExistsAst(this.tableName, this.columnName);
    const present = await lowerer.lowerToExecuteRequest(checks.columnPresent());
    const absent = await lowerer.lowerToExecuteRequest(checks.columnAbsent());
    return {
      id: `dropColumn.${this.tableName}.${this.columnName}`,
      label: `Drop column ${this.columnName} on ${this.tableName}`,
      summary: `Drops column ${this.columnName} on ${this.tableName} which is not in the contract`,
      operationClass: 'destructive',
      target: {
        id: 'sqlite',
        details: buildTargetDetails('column', this.columnName, this.tableName),
      },
      precheck: [
        step(
          `ensure column "${this.columnName}" exists on "${this.tableName}"`,
          present.sql,
          present.params,
        ),
      ],
      execute: [
        step(
          `drop column "${this.columnName}" from "${this.tableName}"`,
          dropColumnExecuteSql(this.tableName, this.columnName),
        ),
      ],
      postcheck: [
        step(
          `verify column "${this.columnName}" is gone from "${this.tableName}"`,
          absent.sql,
          absent.params,
        ),
      ],
    };
  }

  renderTypeScript(): string {
    return `this.dropColumn({ table: ${jsonToTsSource(this.tableName)}, column: ${jsonToTsSource(this.columnName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Index
// ============================================================================

export class CreateIndexCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(tableName: string, indexName: string, columns: readonly string[]) {
    super();
    this.tableName = tableName;
    this.indexName = indexName;
    this.columns = columns;
    this.label = `Create index ${indexName} on ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `CreateIndexCall.toOp: a lowerer is required on the SQLite planner path (index "${this.indexName}" on table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        {
          meta: { factory: this.factoryName, tableName: this.tableName, indexName: this.indexName },
        },
      );
    }
    const checks = indexExistsAst(this.indexName);
    const absent = await lowerer.lowerToExecuteRequest(checks.indexAbsent());
    const present = await lowerer.lowerToExecuteRequest(checks.indexPresent());
    return {
      id: `index.${this.tableName}.${this.indexName}`,
      label: `Create index ${this.indexName} on ${this.tableName}`,
      summary: `Creates index ${this.indexName} on ${this.tableName}`,
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: buildTargetDetails('index', this.indexName, this.tableName),
      },
      precheck: [step(`ensure index "${this.indexName}" is missing`, absent.sql, absent.params)],
      execute: [
        step(
          `create index "${this.indexName}"`,
          buildCreateIndexSql(this.tableName, this.indexName, this.columns),
        ),
      ],
      postcheck: [step(`verify index "${this.indexName}" exists`, present.sql, present.params)],
    };
  }

  renderTypeScript(): string {
    return `this.createIndex({ table: ${jsonToTsSource(this.tableName)}, index: ${jsonToTsSource(this.indexName)}, columns: ${jsonToTsSource(this.columns)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropIndexCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly indexName: string;
  readonly label: string;

  constructor(tableName: string, indexName: string) {
    super();
    this.tableName = tableName;
    this.indexName = indexName;
    this.label = `Drop index ${indexName} on ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw sqliteError(
        'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
        `DropIndexCall.toOp: a lowerer is required on the SQLite planner path (index "${this.indexName}" on table "${this.tableName}"). Pass the control adapter to createSqliteMigrationPlanner.`,
        {
          meta: { factory: this.factoryName, tableName: this.tableName, indexName: this.indexName },
        },
      );
    }
    const checks = indexExistsAst(this.indexName);
    const present = await lowerer.lowerToExecuteRequest(checks.indexPresent());
    const absent = await lowerer.lowerToExecuteRequest(checks.indexAbsent());
    return {
      id: `dropIndex.${this.tableName}.${this.indexName}`,
      label: `Drop index ${this.indexName} on ${this.tableName}`,
      summary: `Drops index ${this.indexName} on ${this.tableName} which is not in the contract`,
      operationClass: 'destructive',
      target: {
        id: 'sqlite',
        details: buildTargetDetails('index', this.indexName, this.tableName),
      },
      precheck: [step(`ensure index "${this.indexName}" exists`, present.sql, present.params)],
      execute: [step(`drop index "${this.indexName}"`, buildDropIndexSql(this.indexName))],
      postcheck: [step(`verify index "${this.indexName}" is gone`, absent.sql, absent.params)],
    };
  }

  renderTypeScript(): string {
    return `this.dropIndex({ table: ${jsonToTsSource(this.tableName)}, index: ${jsonToTsSource(this.indexName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Data transform
// ============================================================================

/**
 * A planner-generated data-transform stub. The current default strategy
 * (`nullabilityTighteningBackfillStrategy`) emits one of these with a
 * backfill-flavored `id`/`label` when the policy allows `'data'` and the
 * contract tightens a column's nullability, but the op itself is generic —
 * any future strategy that needs a placeholder data step can construct one
 * with its own id/label.
 *
 * `toOp()` always throws `MIGRATION.UNFILLED_PLACEHOLDER`: the planner cannot lower a stubbed
 * transform to a runtime op — the user must edit the rendered
 * `migration.ts` and re-emit.
 */
export class DataTransformCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass = 'data' as const;
  readonly id: string;
  readonly label: string;
  readonly tableName: string;
  readonly columnName: string;

  constructor(id: string, label: string, tableName: string, columnName: string) {
    super();
    this.id = id;
    this.label = label;
    this.tableName = tableName;
    this.columnName = columnName;
    this.freeze();
  }

  toOp(_lowerer?: Lowerer): Op {
    throw errorUnfilledPlaceholder(this.label);
  }

  renderTypeScript(): string {
    const slot = `${this.tableName}-${this.columnName}-backfill-sql`;
    return [
      'dataTransform({',
      `  id: ${jsonToTsSource(this.id)},`,
      `  label: ${jsonToTsSource(this.label)},`,
      `  table: ${jsonToTsSource(this.tableName)},`,
      `  description: ${jsonToTsSource(`Backfill NULL ${this.columnName} values in ${this.tableName}`)},`,
      `  run: () => placeholder(${jsonToTsSource(slot)}),`,
      '})',
    ].join('\n');
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName },
      { moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: 'placeholder' },
    ];
  }
}

// ============================================================================
// Raw SQL
// ============================================================================

/**
 * Laundered pre-built operation. Mirrors Postgres's `RawSqlCall`: wraps an
 * already-materialized `SqlMigrationPlanOperation` (typically produced by a
 * SQL-family helper or a codec lifecycle hook) so the planner can carry it
 * alongside structured call IR. `toOp()` returns the stored op unchanged;
 * `renderTypeScript()` emits `rawSql({...})` with the op serialized as a
 * JSON literal — round-tripping requires every field on the op to be
 * JSON-serializable (no closures).
 */
export class RawSqlCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'rawSql' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly op: Op;

  constructor(op: Op) {
    super();
    this.op = op;
    this.label = op.label;
    this.operationClass = op.operationClass;
    this.freeze();
  }

  toOp(_lowerer?: Lowerer): Op {
    return this.op;
  }

  renderTypeScript(): string {
    return `rawSql(${jsonToTsSource(this.op)})`;
  }
}

// ============================================================================
// Union
// ============================================================================

export type SqliteOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | RecreateTableCall
  | RenameTableCall
  | AddColumnCall
  | DropColumnCall
  | CreateIndexCall
  | DropIndexCall
  | DataTransformCall
  | RawSqlCall;
