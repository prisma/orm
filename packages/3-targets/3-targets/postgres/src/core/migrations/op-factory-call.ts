/**
 * Postgres migration IR: one concrete `*Call` class per pure factory under
 * `operations/`, plus a shared `PostgresOpFactoryCallNode` abstract base.
 *
 * Every call class carries the literal arguments its backing factory would
 * receive, computes a human-readable `label` in its constructor, and
 * implements two polymorphic hooks:
 *
 * - `toOp()` — converts the IR node to a runtime
 *   `SqlMigrationPlanOperation` by delegating to the matching pure factory
 *   under `operations/`. `DataTransformCall.toOp()` always throws
 *   `MIGRATION.UNFILLED_PLACEHOLDER` because a planner-generated data transform is an
 *   unfilled authoring stub by construction.
 * - `renderTypeScript()` / `importRequirements()` — inherited from
 *   `TsExpression`. Used by `renderCallsToTypeScript` to emit the call as
 *   a TypeScript expression inside the scaffolded `migration.ts`.
 *
 * The abstract base and all concrete classes are package-private. External
 * consumers see only the framework-level `OpFactoryCall` interface and the
 * `PostgresOpFactoryCall` union.
 */

import { errorUnfilledPlaceholder } from '@internal/errors/migration';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer, Lowerer } from '@internal/family-sql/control-adapter';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import type {
  AnyDdlColumnDefault,
  DdlColumn,
  DdlTableConstraint,
} from '@internal/sql-relational-core/ast';
import { FunctionColumnDefault, LiteralColumnDefault } from '@internal/sql-relational-core/ast';
import { namingOf } from '@internal/sql-schema-ir/naming';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@internal/ts-render';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { assertNever } from '@internal/utils/internal-error';
import {
  columnExistsAst,
  nativeEnumTypeExistsAst,
  nativeEnumValueExistsAst,
  tableExistsAst,
} from '../../contract-free/checks';
import * as contractFreeDdl from '../../contract-free/ddl';
import { postgresError } from '../errors';
import type { PostgresRlsPolicy, RenderedRlsPolicyLiteral } from '../postgres-rls-policy';
import {
  escapeLiteral,
  quoteIdentifier,
  quoteQualifiedName,
  validateEnumValueLength,
} from '../sql-utils';
import type { PostgresColumnDefault } from '../types';
import { boundSchema } from './bound-schema';
import {
  addNotNullColumnDirect,
  alterColumnType,
  dropColumn,
  dropDefault,
  dropNotNull,
  setDefault,
  setNotNull,
} from './operations/columns';
import {
  addCheckConstraint,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  dropCheckConstraint,
  dropConstraint,
  type RenamableConstraintKind,
  renameConstraint,
  renameConstraintLabel,
} from './operations/constraints';
import { createExtension } from './operations/dependencies';
import {
  type CreateIndexElements,
  type CreateIndexExtras,
  createIndex,
  dropIndex,
  renameIndex,
} from './operations/indexes';
import { createNativeEnumType, dropNativeEnumType } from './operations/native-enum-types';
import {
  createRlsPolicy,
  disableRowLevelSecurity,
  dropRlsPolicy,
  enableRowLevelSecurity,
  renameRlsPolicy,
} from './operations/rls';
import type { ForeignKeySpec } from './operations/shared';
import { step, targetDetails } from './operations/shared';
import { dropTable, renameTable } from './operations/tables';
import { buildAddNotNullColumnWithTemporaryDefaultOperation } from './planner-recipes';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

// Single module specifier emitted in user-edited `migration.ts` imports. The
// Postgres migration facade re-exports both the `*Call` factory names
// (createTable / addColumn / …) and the contract-free DDL builders
// (col / lit / fn / primaryKey / foreignKey / unique) from
// sql-relational-core/contract-free. We emit imports against the facade,
// not against the underlying sql-relational-core subpath, because user
// projects depend on `@internal/postgres` (a runtime dep of every
// init-scaffolded project) — they do not depend on the internal
// `@internal/sql-relational-core` package, so an emitted
// `import … from '@internal/sql-relational-core/contract-free'` fails
// ESM resolution at runtime in user migrations even though pnpm has the
// transitive package on disk.
// This is the authored name. `render-typescript.ts` maps it to whatever the
// consuming application's import root calls it, once over the whole assembled
// import list.
const POSTGRES_MIGRATION_FACADE = '@internal/postgres/migration';

abstract class PostgresOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(lowerer?: Lowerer): Op | Promise<Op>;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

// ============================================================================
// Table
// ============================================================================

export function postgresDefaultToDdlColumnDefault(
  columnDefault: PostgresColumnDefault | undefined,
): DdlColumn['default'] {
  if (!columnDefault) return undefined;
  switch (columnDefault.kind) {
    case 'literal':
      return new LiteralColumnDefault(columnDefault.value);
    case 'function':
      if (columnDefault.expression === 'autoincrement()') return undefined;
      return new FunctionColumnDefault(columnDefault.expression);
    case 'sequence':
      return new FunctionColumnDefault(
        `nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`,
      );
    default: {
      const exhaustive: never = columnDefault;
      return assertNever(
        exhaustive,
        `postgresDefaultToDdlColumnDefault: unhandled kind "${blindCast<{ kind: string }, 'exhaustiveness: surface the unhandled default kind'>(exhaustive).kind}"`,
      );
    }
  }
}

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

function renderDdlColumnAsTsCall(col: DdlColumn): string {
  const opts: string[] = [];
  if (col.notNull) opts.push('notNull: true');
  if (col.primaryKey) opts.push('primaryKey: true');
  if (col.default) opts.push(`default: ${renderDdlColumnDefault(col.default)}`);
  if (col.codecRef) opts.push(`codecRef: ${jsonToTsSource(col.codecRef)}`);
  const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
  return `col(${jsonToTsSource(col.name)}, ${jsonToTsSource(col.type)}${optsStr})`;
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
      return `checkExpression(${jsonToTsSource(constraint.name)}, ${jsonToTsSource(constraint.expression)})`;
  }
}

function needsColOrConstraintImport(columns: readonly DdlColumn[]): boolean {
  return columns.length > 0;
}

function constraintImportSymbols(constraints: readonly DdlTableConstraint[] | undefined): string[] {
  if (!constraints || constraints.length === 0) return [];
  const symbols = new Set<string>();
  for (const c of constraints) {
    if (c.kind === 'primary-key') symbols.add('primaryKey');
    else if (c.kind === 'foreign-key') symbols.add('foreignKey');
    else if (c.kind === 'unique') symbols.add('unique');
    else if (c.kind === 'check-expression') symbols.add('checkExpression');
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

export class CreateTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly DdlColumn[];
  readonly constraints: readonly DdlTableConstraint[] | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columns: readonly DdlColumn[],
    constraints?: readonly DdlTableConstraint[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columns = Object.freeze([...columns]);
    this.constraints = constraints ? Object.freeze([...constraints]) : undefined;
    this.label = `Create table "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `CreateTableCall.toOp: a DDL lowerer is required on the Postgres planner path (table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'CreateTableCall' } },
      );
    }
    const ddlNode = contractFreeDdl.createTable({
      ...ifDefined('schema', boundSchema(this.schemaName)),
      table: this.tableName,
      columns: this.columns,
      ...ifDefined('constraints', this.constraints),
    });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    const tableName = this.tableName;
    const checks = tableExistsAst(schemaName, tableName);
    const absent = await lowerer.lowerToExecuteRequest(checks.tableAbsent());
    const present = await lowerer.lowerToExecuteRequest(checks.tablePresent());
    return {
      id: `table.${tableName}`,
      label: `Create table "${tableName}"`,
      summary: `Creates table "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('table', tableName, schemaName),
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
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`columns: [${columnsList}]`);
    if (constraintsList) opts.push(`constraints: [${constraintsList}]`);

    return `this.createTable({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [];
    if (needsColOrConstraintImport(this.columns)) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' });
      for (const sym of defaultImportSymbols(this.columns)) {
        req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
      }
    }
    for (const sym of constraintImportSymbols(this.constraints)) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
    }
    return req;
  }
}

export class DropTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropTable' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.label = `Drop table "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropTableCall.toOp: a lowerer is required on the Postgres planner path (table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropTableCall' } },
      );
    }
    return dropTable(this.schemaName, this.tableName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    return `this.dropTable({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenameTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameTable' as const;
  // `widening` for the same reason as `RenameConstraintCall`: a rename is
  // neither additive creation nor destructive, and the class vocabulary has no
  // neutral middle class, so this is the class that plans under every
  // allowance set except additive-only init.
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly oldTableName: string;
  /** The new name: the table's contract-side identity after the rename. */
  readonly tableName: string;
  readonly label: string;

  constructor(schemaName: string, oldTableName: string, tableName: string) {
    super();
    this.schemaName = schemaName;
    this.oldTableName = oldTableName;
    this.tableName = tableName;
    this.label = `Rename table "${oldTableName}" to "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `RenameTableCall.toOp: a lowerer is required on the Postgres planner path (table "${this.oldTableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'RenameTableCall' } },
      );
    }
    return renameTable(this.schemaName, this.oldTableName, this.tableName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.oldTableName)}`);
    opts.push(`to: ${jsonToTsSource(this.tableName)}`);
    return `...this.renameTable({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Column
// ============================================================================

export class AddColumnCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addColumn' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly column: DdlColumn;
  readonly label: string;

  constructor(schemaName: string, tableName: string, column: DdlColumn) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.column = column;
    this.label = `Add column "${column.name}" to "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddColumnCall.toOp: a DDL lowerer is required on the Postgres planner path (column "${this.column.name}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddColumnCall' } },
      );
    }
    const ddlNode = contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(this.schemaName)),
      table: this.tableName,
      actions: [contractFreeDdl.addColumnAction(this.column)],
    });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    const tableName = this.tableName;
    const columnName = this.column.name;
    const colChecks = columnExistsAst({ schema: schemaName, table: tableName, column: columnName });
    const absent = await lowerer.lowerToExecuteRequest(colChecks.columnAbsent());
    const present = await lowerer.lowerToExecuteRequest(colChecks.columnPresent());
    return {
      id: `column.${schemaName}.${tableName}.${columnName}`,
      label: `Add column "${columnName}" to "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('column', columnName, schemaName, tableName),
      precheck: [step(`ensure column "${columnName}" is missing`, absent.sql, absent.params)],
      execute: [step(`add column "${columnName}"`, statement.sql)],
      postcheck: [step(`verify column "${columnName}" exists`, present.sql, present.params)],
    };
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${renderDdlColumnAsTsCall(this.column)}`);
    return `this.addColumn({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' },
    ];
    for (const sym of defaultImportSymbols([this.column])) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
    }
    return req;
  }
}

export class DropColumnCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropColumn' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop column "${columnName}" from "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropColumnCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropColumnCall' } },
      );
    }
    return dropColumn(this.schemaName, this.tableName, this.columnName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    return `this.dropColumn({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export interface AlterColumnTypeOptions {
  readonly qualifiedTargetType: string;
  readonly formatTypeExpected: string;
  readonly rawTargetTypeForLabel: string;
  readonly using?: string;
}

export class AlterColumnTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'alterColumnType' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly options: AlterColumnTypeOptions;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    options: AlterColumnTypeOptions,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.options = options;
    this.label = `Alter type of "${tableName}"."${columnName}" to ${options.rawTargetTypeForLabel}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AlterColumnTypeCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AlterColumnTypeCall' } },
      );
    }
    return alterColumnType(this.schemaName, this.tableName, this.columnName, this.options, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    opts.push(`options: ${jsonToTsSource(this.options)}`);
    return `this.alterColumnType({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class SetNotNullCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setNotNull' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Set NOT NULL on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `SetNotNullCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'SetNotNullCall' } },
      );
    }
    return setNotNull(this.schemaName, this.tableName, this.columnName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    return `this.setNotNull({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropNotNullCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropNotNull' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop NOT NULL on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropNotNullCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropNotNullCall' } },
      );
    }
    return dropNotNull(this.schemaName, this.tableName, this.columnName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    return `this.dropNotNull({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class SetDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setDefault' as const;
  readonly operationClass: 'additive' | 'widening';
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly defaultSql: string;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    defaultSql: string,
    operationClass: 'additive' | 'widening' = 'additive',
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.defaultSql = defaultSql;
    this.operationClass = operationClass;
    this.label = `Set default on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `SetDefaultCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'SetDefaultCall' } },
      );
    }
    return setDefault(
      this.schemaName,
      this.tableName,
      this.columnName,
      this.defaultSql,
      lowerer,
      this.operationClass,
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    opts.push(`defaultSql: ${jsonToTsSource(this.defaultSql)}`);
    if (this.operationClass !== 'additive') {
      opts.push(`operationClass: ${jsonToTsSource(this.operationClass)}`);
    }
    return `this.setDefault({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropDefault' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop default on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropDefaultCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropDefaultCall' } },
      );
    }
    return dropDefault(this.schemaName, this.tableName, this.columnName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.columnName)}`);
    return `this.dropDefault({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// NOT NULL column additions (planner-internal; no authored surface)
// ============================================================================

/**
 * Planner-internal call for adding a NOT NULL column (no contract default) to
 * a table that must be empty at migration time. Carries the typed `DdlColumn`
 * and lowers it to an ADD COLUMN execute step via the adapter at `toOp` time.
 *
 * No authored `PostgresMigration` method: this call is only emitted by the
 * planner, never hand-written by migration authors.
 */
export class AddNotNullColumnDirectCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'rawSql' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: DdlColumn;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string, column: DdlColumn) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.column = column;
    this.label = `Add column ${columnName} to ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddNotNullColumnDirectCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddNotNullColumnDirectCall' } },
      );
    }
    return addNotNullColumnDirect(this.schemaName, this.tableName, this.column, lowerer);
  }

  renderTypeScript(): string {
    return `rawSql(${jsonToTsSource({ id: `column.${this.tableName}.${this.columnName}`, label: this.label, operationClass: 'additive' })})`;
  }
}

/**
 * Planner-internal call for adding a NOT NULL column (no contract default)
 * using a temporary default value for non-empty tables. Carries all parameters
 * needed for `buildAddNotNullColumnWithTemporaryDefaultOperation`; both the
 * typed ADD COLUMN execute step and the pre/postchecks are lowered via the
 * adapter at `toOp` time.
 *
 * No authored `PostgresMigration` method: this call is only emitted by the
 * planner, never hand-written by migration authors.
 */
export class AddNotNullColumnWithTempDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'rawSql' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: StorageColumn;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly temporaryDefault: string;
  readonly label: string;

  constructor(options: {
    readonly schemaName: string;
    readonly tableName: string;
    readonly columnName: string;
    readonly column: StorageColumn;
    readonly codecHooks: Map<string, CodecControlHooks>;
    readonly storageTypes: Record<string, StorageTypeInstance>;
    readonly temporaryDefault: string;
  }) {
    super();
    this.schemaName = options.schemaName;
    this.tableName = options.tableName;
    this.columnName = options.columnName;
    this.column = options.column;
    this.codecHooks = options.codecHooks;
    this.storageTypes = options.storageTypes;
    this.temporaryDefault = options.temporaryDefault;
    this.label = `Add column ${options.columnName} to ${options.tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddNotNullColumnWithTempDefaultCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddNotNullColumnWithTempDefaultCall' } },
      );
    }
    return buildAddNotNullColumnWithTemporaryDefaultOperation({
      schema: this.schemaName,
      tableName: this.tableName,
      columnName: this.columnName,
      column: this.column,
      codecHooks: this.codecHooks,
      storageTypes: this.storageTypes,
      temporaryDefault: this.temporaryDefault,
      lowerer,
    });
  }

  renderTypeScript(): string {
    return `rawSql(${jsonToTsSource({ id: `column.${this.tableName}.${this.columnName}`, label: this.label, operationClass: 'additive' })})`;
  }
}

// ============================================================================
// Constraints
// ============================================================================

function constraintCallOptions(
  schemaName: string,
  tableName: string,
  constraintName: string,
): string {
  const opts: string[] = [];
  if (schemaName !== UNBOUND_NAMESPACE_ID) {
    opts.push(`schema: ${jsonToTsSource(schemaName)}`);
  }
  opts.push(`table: ${jsonToTsSource(tableName)}`);
  opts.push(`constraint: ${jsonToTsSource(constraintName)}`);
  return opts.join(', ');
}

export class AddPrimaryKeyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addPrimaryKey' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    columns: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.columns = columns;
    this.label = `Add primary key on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddPrimaryKeyCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.constraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddPrimaryKeyCall' } },
      );
    }
    return addPrimaryKey(
      this.schemaName,
      this.tableName,
      this.constraintName,
      this.columns,
      lowerer,
    );
  }

  renderTypeScript(): string {
    return `this.addPrimaryKey({ ${constraintCallOptions(this.schemaName, this.tableName, this.constraintName)}, columns: ${jsonToTsSource(this.columns)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class AddUniqueCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addUnique' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    columns: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.columns = columns;
    this.label = `Add unique constraint on "${tableName}" (${columns.join(', ')})`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddUniqueCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.constraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddUniqueCall' } },
      );
    }
    return addUnique(this.schemaName, this.tableName, this.constraintName, this.columns, lowerer);
  }

  renderTypeScript(): string {
    return `this.addUnique({ ${constraintCallOptions(this.schemaName, this.tableName, this.constraintName)}, columns: ${jsonToTsSource(this.columns)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class AddForeignKeyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addForeignKey' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly fk: ForeignKeySpec;
  readonly label: string;

  constructor(schemaName: string, tableName: string, fk: ForeignKeySpec) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.fk = fk;
    this.label = `Add foreign key "${fk.name}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddForeignKeyCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.fk.name}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddForeignKeyCall' } },
      );
    }
    return addForeignKey(this.schemaName, this.tableName, this.fk, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`foreignKey: ${jsonToTsSource(this.fk)}`);
    return `this.addForeignKey({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropConstraint' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly kind: 'foreignKey' | 'unique' | 'primaryKey';
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    kind: 'foreignKey' | 'unique' | 'primaryKey' = 'unique',
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.kind = kind;
    this.label = `Drop constraint "${constraintName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropConstraintCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.constraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropConstraintCall' } },
      );
    }
    return dropConstraint(this.schemaName, this.tableName, this.constraintName, lowerer, this.kind);
  }

  renderTypeScript(): string {
    const opts = [constraintCallOptions(this.schemaName, this.tableName, this.constraintName)];
    if (this.kind !== 'unique') {
      opts.push(`kind: ${jsonToTsSource(this.kind)}`);
    }
    return `this.dropConstraint({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenameConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameConstraint' as const;
  // `widening` is chosen so the rename plans under every allowance set except
  // additive-only init — a rename is neither additive-creation nor
  // destructive, and the class vocabulary has no neutral middle class. It is
  // NOT that a rename widens anything; this is the accepted typology tradeoff.
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly kind: RenamableConstraintKind;
  readonly oldConstraintName: string;
  readonly newConstraintName: string;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    kind: RenamableConstraintKind,
    oldConstraintName: string,
    newConstraintName: string,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.kind = kind;
    this.oldConstraintName = oldConstraintName;
    this.newConstraintName = newConstraintName;
    this.label = renameConstraintLabel(kind, oldConstraintName, newConstraintName, tableName);
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `RenameConstraintCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.oldConstraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'RenameConstraintCall' } },
      );
    }
    return renameConstraint(
      this.schemaName,
      this.tableName,
      this.kind,
      this.oldConstraintName,
      this.newConstraintName,
      lowerer,
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`kind: ${jsonToTsSource(this.kind)}`);
    opts.push(`from: ${jsonToTsSource(this.oldConstraintName)}`);
    opts.push(`to: ${jsonToTsSource(this.newConstraintName)}`);
    return `this.renameConstraint({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class AddCheckConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addCheckConstraint' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  /** Opaque SQL: the predicate body, rendered verbatim inside `CHECK (…)`. */
  readonly expression: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, constraintName: string, expression: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.expression = expression;
    this.label = `Add check constraint "${constraintName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddCheckConstraintCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.constraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddCheckConstraintCall' } },
      );
    }
    return addCheckConstraint(
      this.schemaName,
      this.tableName,
      this.constraintName,
      this.expression,
      lowerer,
    );
  }

  renderTypeScript(): string {
    return `this.addCheckConstraint({ ${constraintCallOptions(this.schemaName, this.tableName, this.constraintName)}, expression: ${jsonToTsSource(this.expression)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropCheckConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropCheckConstraint' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, constraintName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.label = `Drop check constraint "${constraintName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropCheckConstraintCall.toOp: a lowerer is required on the Postgres planner path (constraint "${this.constraintName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropCheckConstraintCall' } },
      );
    }
    return dropCheckConstraint(this.schemaName, this.tableName, this.constraintName, lowerer);
  }

  renderTypeScript(): string {
    return `this.dropCheckConstraint({ ${constraintCallOptions(this.schemaName, this.tableName, this.constraintName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Indexes
// ============================================================================

export class CreateIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  /** Column tuple when the index is column-based; absent for expression indexes. */
  readonly columns: readonly string[] | undefined;
  /** Opaque whole element list when the index is expression-based. */
  readonly expression: string | undefined;
  // Named indexType (not typeName): `locationForCall` in issue-planner.ts reads
  // a call's `typeName` as a CREATE TYPE target location, which an index is not.
  readonly indexType: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  readonly where: string | undefined;
  readonly unique: boolean;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    indexName: string,
    elements: CreateIndexElements,
    extras?: CreateIndexExtras,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.indexName = indexName;
    this.columns = 'columns' in elements ? elements.columns : undefined;
    this.expression = 'expression' in elements ? elements.expression : undefined;
    this.indexType = extras?.type;
    this.options = extras?.options;
    this.where = extras?.where;
    this.unique = extras?.unique === true;
    this.label = `Create index "${indexName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `CreateIndexCall.toOp: a lowerer is required on the Postgres planner path (index "${this.indexName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'CreateIndexCall' } },
      );
    }
    const extras: {
      type?: string;
      options?: Record<string, unknown>;
      where?: string;
      unique?: boolean;
    } = {};
    if (this.indexType !== undefined) extras.type = this.indexType;
    if (this.options !== undefined) extras.options = this.options;
    if (this.where !== undefined) extras.where = this.where;
    if (this.unique) extras.unique = true;
    return createIndex(
      this.schemaName,
      this.tableName,
      this.indexName,
      this.columns !== undefined
        ? { columns: this.columns }
        : { expression: this.expression ?? '' },
      lowerer,
      extras,
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`index: ${jsonToTsSource(this.indexName)}`);
    if (this.columns !== undefined) {
      opts.push(`columns: ${jsonToTsSource(this.columns)}`);
    } else {
      opts.push(`expression: ${jsonToTsSource(this.expression ?? '')}`);
    }
    if (
      this.indexType !== undefined ||
      this.options !== undefined ||
      this.where !== undefined ||
      this.unique
    ) {
      const extrasParts: string[] = [];
      if (this.indexType !== undefined) extrasParts.push(`type: ${jsonToTsSource(this.indexType)}`);
      if (this.options !== undefined) extrasParts.push(`options: ${jsonToTsSource(this.options)}`);
      if (this.where !== undefined) extrasParts.push(`where: ${jsonToTsSource(this.where)}`);
      if (this.unique) extrasParts.push('unique: true');
      opts.push(`extras: { ${extrasParts.join(', ')} }`);
    }
    return `this.createIndex({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenameIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameIndex' as const;
  // `widening` is chosen so the rename plans under every allowance set except
  // additive-only init — a rename is neither additive-creation nor
  // destructive, and the class vocabulary has no neutral middle class. It is
  // NOT that a rename widens anything; this is the accepted typology tradeoff.
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly oldIndexName: string;
  readonly newIndexName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, oldIndexName: string, newIndexName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.oldIndexName = oldIndexName;
    this.newIndexName = newIndexName;
    this.label = `Rename index "${oldIndexName}" to "${newIndexName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `RenameIndexCall.toOp: a lowerer is required on the Postgres planner path (index "${this.oldIndexName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'RenameIndexCall' } },
      );
    }
    return renameIndex(
      this.schemaName,
      this.tableName,
      this.oldIndexName,
      this.newIndexName,
      lowerer,
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`from: ${jsonToTsSource(this.oldIndexName)}`);
    opts.push(`to: ${jsonToTsSource(this.newIndexName)}`);
    return `this.renameIndex({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, indexName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.indexName = indexName;
    this.label = `Drop index "${indexName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropIndexCall.toOp: a lowerer is required on the Postgres planner path (index "${this.indexName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropIndexCall' } },
      );
    }
    return dropIndex(this.schemaName, this.tableName, this.indexName, lowerer);
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`index: ${jsonToTsSource(this.indexName)}`);
    return `this.dropIndex({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Raw SQL
// ============================================================================

/**
 * Laundered pre-built operation.
 *
 * Wraps an already-materialized `SqlMigrationPlanOperation` — typically one
 * produced by a SQL-family method or a codec control hook — so the planner
 * can carry it alongside IR nodes without reverse-engineering it into a
 * structured call class. Doubles as the user-facing escape hatch for raw
 * migrations: authors can pass a full op shape to `rawSql({...})`.
 *
 * `toOp()` returns the stored op unchanged. `renderTypeScript()` emits
 * `rawSql({...})` with the op serialized as a JSON literal — round-tripping
 * requires every field on the op to be JSON-serializable (no closures).
 */
export class RawSqlCall extends PostgresOpFactoryCallNode {
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

  toOp(): Op {
    return this.op;
  }

  renderTypeScript(): string {
    return `rawSql(${jsonToTsSource(this.op)})`;
  }
}

// ============================================================================
// Database dependencies (structured DDL)
// ============================================================================

export class CreateExtensionCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createExtension' as const;
  readonly operationClass = 'additive' as const;
  readonly extensionName: string;
  readonly label: string;

  constructor(extensionName: string) {
    super();
    this.extensionName = extensionName;
    this.label = `Create extension "${extensionName}"`;
    this.freeze();
  }

  toOp(): Op {
    return createExtension(this.extensionName);
  }

  renderTypeScript(): string {
    return `createExtension(${jsonToTsSource(this.extensionName)})`;
  }
}

export class CreateSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createSchema' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly label: string;

  constructor(schemaName: string) {
    super();
    this.schemaName = schemaName;
    this.label = `Create schema "${schemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `CreateSchemaCall.toOp: a DDL lowerer is required on the Postgres planner path (schema "${this.schemaName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'CreateSchemaCall' } },
      );
    }
    const ddlNode = contractFreeDdl.createSchema({ schema: this.schemaName, ifNotExists: true });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    return {
      id: `schema.${schemaName}`,
      label: `Create schema "${schemaName}"`,
      operationClass: 'additive',
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Create schema "${schemaName}"`,
          sql: statement.sql,
          params: statement.params ?? [],
        },
      ],
      postcheck: [],
    };
  }

  renderTypeScript(): string {
    return `this.createSchema({ schema: ${jsonToTsSource(this.schemaName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Native enum types
// ============================================================================

export class CreateNativeEnumTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createNativeEnumType' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly members: readonly string[];
  readonly label: string;

  constructor(schemaName: string, typeName: string, members: readonly string[]) {
    super();
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.members = Object.freeze([...members]);
    this.label = `Create enum type "${typeName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `CreateNativeEnumTypeCall.toOp: a DDL lowerer is required on the Postgres planner path (type "${this.typeName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'CreateNativeEnumTypeCall' } },
      );
    }
    return createNativeEnumType(this.schemaName, this.typeName, this.members, lowerer);
  }

  renderTypeScript(): string {
    const opts = [
      `schema: ${jsonToTsSource(this.schemaName)}`,
      `typeName: ${jsonToTsSource(this.typeName)}`,
      `members: ${jsonToTsSource(this.members)}`,
    ];
    return `this.createNativeEnumType({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropNativeEnumTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropNativeEnumType' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly label: string;

  constructor(schemaName: string, typeName: string) {
    super();
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.label = `Drop enum type "${typeName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropNativeEnumTypeCall.toOp: a DDL lowerer is required on the Postgres planner path (type "${this.typeName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropNativeEnumTypeCall' } },
      );
    }
    return dropNativeEnumType(this.schemaName, this.typeName, lowerer);
  }

  renderTypeScript(): string {
    const opts = [
      `schema: ${jsonToTsSource(this.schemaName)}`,
      `typeName: ${jsonToTsSource(this.typeName)}`,
    ];
    return `this.dropNativeEnumType({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

/** Schema-qualified, quoted enum type name — unqualified when `schemaName` is the unbound sentinel, matching `boundSchema`'s DDL-node convention. */
function qualifiedNativeEnumTypeName(schemaName: string, typeName: string): string {
  const bound = boundSchema(schemaName);
  return quoteQualifiedName(bound === undefined ? typeName : `${bound}.${typeName}`);
}

const ADD_VALUE_TRANSACTION_CAVEAT =
  'A newly added enum value cannot be used until the transaction that adds it commits, so a ' +
  'migration that both appends a value and uses it in the same step will fail at apply.';

/**
 * `ALTER TYPE <qualified> ADD VALUE '<value>'` for a suffix-appended member on
 * a managed native enum. Built directly as SQL text (qualified via
 * `quoteQualifiedName`, the value escaped via `escapeLiteral`) rather than a
 * typed DDL node — mirrors how `enableRowLevelSecurity` renders its execute
 * step, since no DDL-AST node exists for this statement. Prechecks/postchecks
 * are still typed catalog queries lowered through the control adapter.
 * `validateEnumValueLength` runs at construction, so an over-length value
 * fails before planning produces a call.
 */
export class AddNativeEnumValueCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addNativeEnumValue' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly value: string;
  readonly label: string;
  readonly summary: string;

  constructor(schemaName: string, typeName: string, value: string) {
    super();
    validateEnumValueLength(value, typeName);
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.value = value;
    this.label = `Add value "${value}" to enum type "${typeName}"`;
    this.summary = `Adds value "${value}" to enum type "${typeName}". ${ADD_VALUE_TRANSACTION_CAVEAT}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddNativeEnumValueCall.toOp: a lowerer is required on the Postgres planner path (type "${this.typeName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddNativeEnumValueCall' } },
      );
    }
    const { schemaName, typeName, value } = this;
    const typeChecks = nativeEnumTypeExistsAst(schemaName, typeName);
    const valueChecks = nativeEnumValueExistsAst({ schema: schemaName, typeName, value });
    const typePresent = await lowerer.lowerToExecuteRequest(typeChecks.typePresent());
    const valueAbsent = await lowerer.lowerToExecuteRequest(valueChecks.valueAbsent());
    const valuePresent = await lowerer.lowerToExecuteRequest(valueChecks.valuePresent());
    const qualifiedType = qualifiedNativeEnumTypeName(schemaName, typeName);
    return {
      id: `addNativeEnumValue.${typeName}.${value}`,
      label: this.label,
      summary: this.summary,
      operationClass: 'additive',
      target: targetDetails('type', typeName, schemaName),
      precheck: [
        step(`ensure enum type "${typeName}" exists`, typePresent.sql, typePresent.params),
        step(
          `ensure value "${value}" is absent from enum type "${typeName}"`,
          valueAbsent.sql,
          valueAbsent.params,
        ),
      ],
      execute: [
        step(
          `add value "${value}" to enum type "${typeName}"`,
          `ALTER TYPE ${qualifiedType} ADD VALUE '${escapeLiteral(value)}'`,
        ),
      ],
      postcheck: [
        step(
          `verify value "${value}" exists on enum type "${typeName}"`,
          valuePresent.sql,
          valuePresent.params,
        ),
      ],
    };
  }

  renderTypeScript(): string {
    const opts = [
      `schema: ${jsonToTsSource(this.schemaName)}`,
      `typeName: ${jsonToTsSource(this.typeName)}`,
      `value: ${jsonToTsSource(this.value)}`,
    ];
    return `this.addNativeEnumValue({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Data transform
// ============================================================================

/**
 * A planner-generated data-transform stub. `checkSlot` and `runSlot` name
 * the unfilled authoring slots that the rendered `migration.ts` will expose
 * to the user via `placeholder("…")` calls. `toOp()` always throws
 * `MIGRATION.UNFILLED_PLACEHOLDER`: the planner cannot lower a stubbed transform to a runtime
 * op — the user must fill the rendered `migration.ts` and re-emit.
 */
export class DataTransformCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly checkSlot: string;
  readonly runSlot: string;

  constructor(
    label: string,
    checkSlot: string,
    runSlot: string,
    operationClass: MigrationOperationClass = 'data',
  ) {
    super();
    this.label = label;
    this.checkSlot = checkSlot;
    this.runSlot = runSlot;
    this.operationClass = operationClass;
    this.freeze();
  }

  toOp(): Op {
    throw errorUnfilledPlaceholder(this.label);
  }

  renderTypeScript(): string {
    return [
      `this.dataTransform(endContract, ${jsonToTsSource(this.label)}, {`,
      `  check: () => placeholder(${jsonToTsSource(this.checkSlot)}),`,
      `  run: () => placeholder(${jsonToTsSource(this.runSlot)}),`,
      '})',
    ].join('\n');
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'placeholder' },
      // endContract is imported by the migration scaffold's contractImports; an op never renders outside it.
    ];
  }
}

export class CreatePostgresRlsPolicyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createRlsPolicy' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly policy: PostgresRlsPolicy;
  readonly label: string;

  constructor(schemaName: string, tableName: string, policy: PostgresRlsPolicy) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.policy = policy;
    this.label = `Create RLS policy "${policy.name}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `CreatePostgresRlsPolicyCall.toOp: a lowerer is required on the Postgres planner path (policy "${this.policy.name}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'CreatePostgresRlsPolicyCall' } },
      );
    }
    return createRlsPolicy(this.schemaName, this.tableName, this.policy, lowerer);
  }

  renderTypeScript(): string {
    const p = this.policy;
    // Typed as the parameter `createRlsPolicy` accepts, so a drift between
    // the renderer and the API is a compile error here rather than in the
    // user's generated migration.
    const input: RenderedRlsPolicyLiteral = {
      naming: namingOf(p.name, p.prefix),
      tableName: p.tableName,
      namespaceId: p.namespaceId,
      operation: p.operation,
      roles: p.roles,
      ...ifDefined('using', p.using),
      ...ifDefined('withCheck', p.withCheck),
      permissive: p.permissive,
    };
    return `this.createRlsPolicy({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)}, policy: ${jsonToTsSource(input)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropPostgresRlsPolicyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropRlsPolicy' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly policyName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, policyName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.policyName = policyName;
    this.label = `Drop RLS policy "${policyName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DropPostgresRlsPolicyCall.toOp: a lowerer is required on the Postgres planner path (policy "${this.policyName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DropPostgresRlsPolicyCall' } },
      );
    }
    return dropRlsPolicy(this.schemaName, this.tableName, this.policyName, lowerer);
  }

  renderTypeScript(): string {
    return `this.dropRlsPolicy({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)}, policy: ${jsonToTsSource(this.policyName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class EnableRowLevelSecurityCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'enableRowLevelSecurity' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.label = `Enable row-level security on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `EnableRowLevelSecurityCall.toOp: a lowerer is required on the Postgres planner path (table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'EnableRowLevelSecurityCall' } },
      );
    }
    return enableRowLevelSecurity(this.schemaName, this.tableName, lowerer);
  }

  renderTypeScript(): string {
    return `this.enableRowLevelSecurity({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DisableRowLevelSecurityCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'disableRowLevelSecurity' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.label = `Disable row-level security on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `DisableRowLevelSecurityCall.toOp: a lowerer is required on the Postgres planner path (table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'DisableRowLevelSecurityCall' } },
      );
    }
    return disableRowLevelSecurity(this.schemaName, this.tableName, lowerer);
  }

  renderTypeScript(): string {
    return `this.disableRowLevelSecurity({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenamePostgresRlsPolicyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameRlsPolicy' as const;
  // `widening` is chosen so the rename plans under every allowance set except
  // additive-only init — a rename is neither additive-creation nor
  // destructive, and the class vocabulary has no neutral middle class. It is
  // NOT that a rename widens anything; this is the accepted typology tradeoff.
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly oldPolicyName: string;
  readonly newPolicyName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, oldPolicyName: string, newPolicyName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.oldPolicyName = oldPolicyName;
    this.newPolicyName = newPolicyName;
    this.label = `Rename RLS policy "${oldPolicyName}" to "${newPolicyName}" on "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `RenamePostgresRlsPolicyCall.toOp: a lowerer is required on the Postgres planner path (policy "${this.oldPolicyName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'RenamePostgresRlsPolicyCall' } },
      );
    }
    return renameRlsPolicy(
      this.schemaName,
      this.tableName,
      this.oldPolicyName,
      this.newPolicyName,
      lowerer,
    );
  }

  renderTypeScript(): string {
    return `this.renameRlsPolicy({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)}, from: ${jsonToTsSource(this.oldPolicyName)}, to: ${jsonToTsSource(this.newPolicyName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export type PostgresOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | RenameTableCall
  | AddColumnCall
  | DropColumnCall
  | AlterColumnTypeCall
  | SetNotNullCall
  | DropNotNullCall
  | SetDefaultCall
  | DropDefaultCall
  | AddNotNullColumnDirectCall
  | AddNotNullColumnWithTempDefaultCall
  | AddPrimaryKeyCall
  | AddForeignKeyCall
  | AddUniqueCall
  | AddCheckConstraintCall
  | RenameConstraintCall
  | DropCheckConstraintCall
  | CreateIndexCall
  | RenameIndexCall
  | DropIndexCall
  | DropConstraintCall
  | RawSqlCall
  | CreateExtensionCall
  | CreateSchemaCall
  | CreateNativeEnumTypeCall
  | DropNativeEnumTypeCall
  | AddNativeEnumValueCall
  | CreatePostgresRlsPolicyCall
  | DropPostgresRlsPolicyCall
  | EnableRowLevelSecurityCall
  | DisableRowLevelSecurityCall
  | RenamePostgresRlsPolicyCall
  | DataTransformCall;
