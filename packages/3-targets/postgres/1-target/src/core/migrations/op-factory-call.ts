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
 *   under `operations/`. `DataTransformCall.toOp()` always rejects with
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

import { unfilledPlaceholderOperation } from '@internal/errors/migration';
import {
  checkSqlDefaultText,
  checkSqlExpressionText,
  createSqlTextSources,
  encodeStoredValue,
  isUnfilledSlot,
  type SqlMigrationPlanOperation,
  type SqlSlot,
  type SqlTextSources,
  type StoredValueCodec,
  slotSource,
  sqlOfSlot,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer, Lowerer } from '@internal/family-sql/control-adapter';
import type { DataType } from '@internal/framework-components/codec';
import type {
  EnumValueCoordinateJson,
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@internal/framework-components/control';
import { expectAbsent, expectPresent } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { AnyDdlColumnDefault, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import {
  DdlColumn,
  FunctionColumnDefault,
  LiteralColumnDefault,
  opaqueSql,
} from '@internal/sql-relational-core/ast';
import { col } from '@internal/sql-relational-core/contract-free';
import { namingOf } from '@internal/sql-schema-ir/naming';
import {
  type ImportRequirement,
  jsonToTsSource,
  TsExpression,
  tsObjectSource,
} from '@internal/ts-render';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { assertNever } from '@internal/utils/internal-error';
import {
  columnDefaultSequenceAst,
  columnExistsAst,
  columnNullabilityAst,
  nativeEnumTypeExistsAst,
  nativeEnumValueExistsAst,
  relationKindAst,
  tableExistsAst,
} from '../../contract-free/checks';
import * as contractFreeDdl from '../../contract-free/ddl';
import type { CreateIndexElements } from '../ddl/nodes';
import { postgresError } from '../errors';
import type { PostgresRlsPolicy, RenderedRlsPolicyLiteral } from '../postgres-rls-policy';
import {
  escapeLiteral,
  POSTGRES_QUOTING,
  quoteIdentifier,
  quoteQualifiedName,
  validateEnumValueLength,
} from '../sql-utils';
import type { PostgresColumnDefault } from '../types';
import {
  type AutoincrementWidth,
  autoincrementWidth,
  autoincrementWidthOfPseudoType,
} from './autoincrement-widths';
import { boundSchema } from './bound-schema';
import {
  type AlterColumnTypeClass,
  addRequiredColumnToEmptyTable,
  alterColumnType,
  columnTypeStep,
  dropColumn,
  dropDefault,
  dropNotNull,
  renameColumn,
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
import type { DataTransformColumn } from './operations/data-transform';
import { createExtension, dropExtension, setExtensionSchema } from './operations/dependencies';
import { type CreateIndexExtras, createIndex, dropIndex, renameIndex } from './operations/indexes';
import { createNativeEnumType, dropNativeEnumType } from './operations/native-enum-types';
import {
  createRlsPolicy,
  disableRowLevelSecurity,
  dropRlsPolicy,
  enableRowLevelSecurity,
  renameRlsPolicy,
} from './operations/rls';
import { dropSchema, renameSchema, setTableSchema } from './operations/schemas';
import type { ForeignKeySpec } from './operations/shared';
import { step, targetDetails } from './operations/shared';
import { removeStoredValue, replaceStoredValue, storedValueText } from './operations/stored-values';
import { dropTable, renameTable } from './operations/tables';
import { buildAddNotNullColumnWithTemporaryDefaultOperation } from './planner-recipes';
import {
  alterTypeCheck,
  type ColumnTypeCheck,
  columnTypeCheckIfReadable,
} from './planner-sql-checks';
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

  /** The operations this call lowers to, in order: one, unless the call carries companions. */
  toOps(lowerer?: ExecuteRequestLowerer): readonly (Op | Promise<Op>)[] {
    return [this.toOp(lowerer)];
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

export type { PostgresOpFactoryCallNode };

/** Whether `call` is one of this target's calls, which lower through {@link PostgresOpFactoryCallNode.toOps}. */
export function isPostgresOpFactoryCall(
  call: FrameworkOpFactoryCall,
): call is PostgresOpFactoryCallNode {
  return call instanceof PostgresOpFactoryCallNode;
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
      return new FunctionColumnDefault(opaqueSql(columnDefault.expression));
    case 'sequence':
      return new FunctionColumnDefault(
        opaqueSql(`nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`),
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

interface WrittenCall {
  readonly source: string;
  readonly imports: readonly ImportRequirement[];
}

function renderDdlColumnDefault(def: AnyDdlColumnDefault | undefined, sql: SqlTextSources): string {
  if (!def) return '';
  if (def.kind === 'literal') {
    return `lit(${jsonToTsSource(def.value)})`;
  }
  return `fn(${sql.source(def.expression.text)})`;
}

function renderDdlColumnAsTsCall(col: DdlColumn, sql: SqlTextSources): string {
  const opts: string[] = [];
  if (col.notNull) opts.push('notNull: true');
  if (col.primaryKey) opts.push('primaryKey: true');
  if (col.default) opts.push(`default: ${renderDdlColumnDefault(col.default, sql)}`);
  if (col.codecRef) opts.push(`codecRef: ${jsonToTsSource(col.codecRef)}`);
  const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
  return `col(${jsonToTsSource(col.name)}, ${jsonToTsSource(col.type)}${optsStr})`;
}

function renderDdlConstraintAsTsCall(constraint: DdlTableConstraint, sql: SqlTextSources): string {
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
      return `checkExpression(${jsonToTsSource(constraint.name)}, ${sql.source(constraint.expression.text)})`;
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

/** `pg_class.relkind` of an ordinary or a partitioned table. */
const TABLE_RELATION_KINDS = ['r', 'p'] as const;

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
    const absent = await lowerer.lowerToExecuteRequest(
      tableExistsAst(schemaName, tableName).tableAbsent(),
    );
    const isTable = await lowerer.lowerToExecuteRequest(
      relationKindAst({ schema: schemaName, name: tableName, kinds: TABLE_RELATION_KINDS }),
    );
    return {
      id: `table.${tableName}`,
      label: `Create table "${tableName}"`,
      summary: `Creates table "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('table', tableName, schemaName),
      precheck: [
        step(
          `ensure table "${tableName}" does not exist`,
          absent.sql,
          absent.params,
          expectAbsent(`table "${tableName}"`),
        ),
      ],
      execute: [
        {
          description: `create table "${tableName}"`,
          sql: statement.sql,
          params: statement.params ?? [],
        },
      ],
      postcheck: [
        step(
          `verify table "${tableName}" exists`,
          isTable.sql,
          isTable.params,
          expectPresent(`table "${tableName}"`),
        ),
      ],
    };
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const columnsList = this.columns
      .map((column) => renderDdlColumnAsTsCall(column, sql))
      .join(', ');
    const constraintsList = this.constraints
      ? this.constraints
          .map((constraint) => renderDdlConstraintAsTsCall(constraint, sql))
          .join(', ')
      : undefined;

    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`columns: [${columnsList}]`);
    if (constraintsList) opts.push(`constraints: [${constraintsList}]`);

    return { source: `this.createTable({ ${opts.join(', ')} })`, imports: sql.imports() };
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
    req.push(...this.#written().imports);
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

/** A rename a table or column rename carries for an object whose name derives from the old name. */
export type RenameCompanionCall = RenameConstraintCall | RenameIndexCall;

export class RenameTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameTable' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly oldTableName: string;
  /** The new name: the table's contract-side identity after the rename. */
  readonly tableName: string;
  readonly label: string;
  /**
   * The renames of objects whose names derive from the table name. They run after the table rename
   * and are never rendered on their own.
   */
  readonly companions: readonly RenameCompanionCall[];

  constructor(
    schemaName: string,
    oldTableName: string,
    tableName: string,
    companions: readonly RenameCompanionCall[],
  ) {
    super();
    this.schemaName = schemaName;
    this.oldTableName = oldTableName;
    this.tableName = tableName;
    this.label = `Rename table "${oldTableName}" to "${tableName}"`;
    this.companions = Object.freeze([...companions]);
    this.freeze();
  }

  override toOps(lowerer?: ExecuteRequestLowerer): readonly (Op | Promise<Op>)[] {
    return [this.toOp(lowerer), ...this.companions.map((companion) => companion.toOp(lowerer))];
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
  /** How the postcheck recognises the column's type, or `undefined` when the stack's data types do not read it. */
  readonly checkType: ColumnTypeCheck | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    column: DdlColumn,
    dataTypes: readonly DataType[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.column = column;
    this.checkType = columnTypeCheckIfReadable(column.type, dataTypes);
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
    const location = { schema: schemaName, table: tableName, column: columnName };
    const colChecks = columnExistsAst(location);
    const absent = await lowerer.lowerToExecuteRequest(colChecks.columnAbsent());
    const present = await lowerer.lowerToExecuteRequest(colChecks.columnPresent());
    const hasType = await columnTypeStep(lowerer, location, this.column.type, this.checkType);
    const notNullable =
      this.column.notNull === true || this.column.primaryKey === true
        ? [
            await lowerer.lowerToExecuteRequest(
              columnNullabilityAst({ ...location, nullable: false }),
            ),
          ]
        : [];
    const sequenceDefault =
      autoincrementWidthOfPseudoType(this.column.type) === undefined
        ? []
        : [await lowerer.lowerToExecuteRequest(columnDefaultSequenceAst(location))];
    return {
      id: `column.${schemaName}.${tableName}.${columnName}`,
      label: `Add column "${columnName}" to "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('column', columnName, schemaName, tableName),
      precheck: [
        step(
          `ensure column "${columnName}" is missing`,
          absent.sql,
          absent.params,
          expectAbsent(`column "${columnName}" on "${tableName}"`),
        ),
      ],
      execute: [step(`add column "${columnName}"`, statement.sql)],
      postcheck: [
        step(
          `verify column "${columnName}" exists`,
          present.sql,
          present.params,
          expectPresent(`column "${columnName}" on "${tableName}"`),
        ),
        hasType,
        ...notNullable.map((check) =>
          step(`verify column "${columnName}" is NOT NULL`, check.sql, check.params),
        ),
        ...sequenceDefault.map((check) =>
          step(
            `verify column "${columnName}" takes its default from an attached sequence`,
            check.sql,
            check.params,
          ),
        ),
      ],
    };
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${renderDdlColumnAsTsCall(this.column, sql)}`);
    return { source: `this.addColumn({ ${opts.join(', ')} })`, imports: sql.imports() };
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' },
    ];
    for (const sym of defaultImportSymbols([this.column])) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
    }
    req.push(...this.#written().imports);
    return req;
  }
}

export class RenameColumnCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameColumn' as const;
  // `widening` for the same reason as `RenameTableCall`.
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly oldColumnName: string;
  /** The new name: the column's contract-side identity after the rename. */
  readonly columnName: string;
  readonly label: string;
  /**
   * The renames of objects whose names derive from the column name. They run after the column
   * rename and are never rendered on their own.
   */
  readonly companions: readonly RenameCompanionCall[];

  constructor(
    schemaName: string,
    tableName: string,
    oldColumnName: string,
    columnName: string,
    companions: readonly RenameCompanionCall[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.oldColumnName = oldColumnName;
    this.columnName = columnName;
    this.label = `Rename column "${tableName}"."${oldColumnName}" to "${columnName}"`;
    this.companions = Object.freeze([...companions]);
    this.freeze();
  }

  override toOps(lowerer?: ExecuteRequestLowerer): readonly (Op | Promise<Op>)[] {
    return [this.toOp(lowerer), ...this.companions.map((companion) => companion.toOp(lowerer))];
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `RenameColumnCall.toOp: a lowerer is required on the Postgres planner path (column "${this.oldColumnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'RenameColumnCall' } },
      );
    }
    return renameColumn(
      this.schemaName,
      this.tableName,
      this.oldColumnName,
      this.columnName,
      lowerer,
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${jsonToTsSource(this.oldColumnName)}`);
    opts.push(`to: ${jsonToTsSource(this.columnName)}`);
    return `...this.renameColumn({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
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

/** An `alterColumnType` call named by the column it alters, as its errors name it. */
export function alterColumnTypeCallText(schema: string, table: string, column: string): string {
  return `alterColumnType({ ${columnCallLocation(schema, table, column).join(', ')} })`;
}

export class AlterColumnTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'alterColumnType' as const;
  readonly operationClass: AlterColumnTypeClass;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  /** The new type as a migration writes it. */
  readonly type: string;
  /** The new type is a raw type, named by its catalog text (ADR 273), so its text is checked as written. */
  readonly raw: true | undefined;
  readonly using: SqlSlot | undefined;
  /** How the postcheck recognises the column's new type once the alter has run. */
  readonly checkType: ColumnTypeCheck;
  /** The width the sequence the column owns takes, when the column has an `autoincrement()` default and an integer type. */
  readonly sequenceWidth: AutoincrementWidth | undefined;
  readonly label: string;

  constructor(input: {
    readonly schemaName: string;
    readonly tableName: string;
    readonly columnName: string;
    readonly type: string;
    readonly raw?: true;
    readonly using?: SqlSlot;
    /** The data types of the stack, which read `type` for the postcheck. */
    readonly dataTypes: readonly DataType[];
    /** By default `data` when `using` converts the values, and `destructive` otherwise. */
    readonly operationClass?: AlterColumnTypeClass;
    /** Whether the column, before the change, takes its values from a sequence it owns (`autoincrement()`). */
    readonly ownsAutoincrementSequence: boolean;
  }) {
    super();
    this.schemaName = input.schemaName;
    this.tableName = input.tableName;
    this.columnName = input.columnName;
    this.type = input.type;
    this.raw = input.raw;
    this.using = input.using;
    this.sequenceWidth = input.ownsAutoincrementSequence
      ? autoincrementWidth(input.type)
      : undefined;
    this.operationClass = input.operationClass ?? this.#defaultClass();
    this.#refuseUnsafeUsing();
    this.checkType = alterTypeCheck(
      input.type,
      input.dataTypes,
      this.#callText(),
      input.raw === true,
    );
    this.label = `Alter type of "${input.tableName}"."${input.columnName}" to ${input.type}`;
    this.freeze();
  }

  #refuseUnsafeUsing(): void {
    if (this.using?.kind !== 'sql') return;
    const refused = checkSqlExpressionText(this.using.sql, POSTGRES_QUOTING);
    if (refused === undefined) return;
    const call = this.#callText();
    throw postgresError(
      'MIGRATION.SQL_EXPRESSION_INVALID',
      `${call}: using ${JSON.stringify(this.using.sql)} holds ${refused}, which could end or extend the ALTER COLUMN … TYPE statement it is written into`,
      {
        why: 'The conversion is written into the USING clause of ALTER COLUMN … TYPE. The check refuses a semicolon, a SQL comment, dollar quoting, and a comma or a statement keyword outside parentheses, since each could end or extend that statement; it does not check that the text is valid SQL.',
        fix: `Write using as one SQL expression over the column, such as "${this.columnName}"::${this.type}. If it holds a comma or a keyword such as FROM outside parentheses, wrap it in parentheses.`,
        meta: { call, field: 'using', expression: this.using.sql, refused },
      },
    );
  }

  #defaultClass(): AlterColumnTypeClass {
    return this.using === undefined ? 'destructive' : 'data';
  }

  #callText(): string {
    return alterColumnTypeCallText(this.schemaName, this.tableName, this.columnName);
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (isUnfilledSlot(this.using)) {
      return unfilledPlaceholderOperation(this.label);
    }
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AlterColumnTypeCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AlterColumnTypeCall' } },
      );
    }
    return alterColumnType(
      this.schemaName,
      this.tableName,
      this.columnName,
      {
        type: this.type,
        checkType: this.checkType,
        ...ifDefined('using', sqlOfSlot(this.using)),
        sequenceWidth: this.sequenceWidth,
      },
      lowerer,
      this.operationClass,
    );
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      ...(isUnfilledSlot(this.using)
        ? [{ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'placeholder' }]
        : []),
      ...this.#written().imports,
    ];
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const using = this.using === undefined ? [] : [`using: ${slotSource(this.using, sql)}`];
    const opts = [
      ...columnCallLocation(this.schemaName, this.tableName, this.columnName),
      `type: ${jsonToTsSource(this.type)}`,
      ...(this.raw === true ? ['raw: true'] : []),
      ...using,
      ...(this.operationClass === this.#defaultClass()
        ? []
        : [`operationClass: ${jsonToTsSource(this.operationClass)}`]),
    ];
    return { source: `this.alterColumnType({ ${opts.join(', ')} })`, imports: sql.imports() };
  }
}

export class SetNotNullCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setNotNull' as const;
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
  /** The column with the default to set, its type and its codec; the adapter writes the clause. */
  readonly column: DdlColumn;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    column: DdlColumn,
    operationClass: 'additive' | 'widening',
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.column = column;
    this.operationClass = operationClass;
    this.label = `Set default on "${tableName}"."${column.name}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `SetDefaultCall.toOp: a lowerer is required on the Postgres planner path (column "${this.column.name}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'SetDefaultCall' } },
      );
    }
    return setDefault(this.schemaName, this.tableName, this.column, lowerer, this.operationClass);
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${renderDdlColumnAsTsCall(this.column, sql)}`);
    return { source: `this.setDefault({ ${opts.join(', ')} })`, imports: sql.imports() };
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' },
      ...defaultImportSymbols([this.column]).map((symbol) => ({
        moduleSpecifier: POSTGRES_MIGRATION_FACADE,
        symbol,
      })),
      ...this.#written().imports,
    ];
  }
}

export class DropDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropDefault' as const;
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
// NOT NULL column additions
// ============================================================================

function columnCallLocation(schemaName: string, tableName: string, columnName: string): string[] {
  return [
    ...(schemaName === UNBOUND_NAMESPACE_ID ? [] : [`schema: ${jsonToTsSource(schemaName)}`]),
    `table: ${jsonToTsSource(tableName)}`,
    `column: ${jsonToTsSource(columnName)}`,
  ];
}

/**
 * Adds a required column with no default to a table that must be empty when the migration runs:
 * a column in a new primary key, unique constraint or foreign key, where one temporary value in
 * every row would break the constraint.
 */
export class AddRequiredColumnToEmptyTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addRequiredColumnToEmptyTable' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  /** The column's type as a migration writes it. */
  readonly type: string;
  /** The type `format_type` prints for `type`, or `undefined` when the stack's data types do not read it. */
  readonly checkType: ColumnTypeCheck | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    type: string,
    dataTypes: readonly DataType[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.type = type;
    this.checkType = columnTypeCheckIfReadable(type, dataTypes);
    this.label = `Add column ${columnName} to ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddRequiredColumnToEmptyTableCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddRequiredColumnToEmptyTableCall' } },
      );
    }
    return addRequiredColumnToEmptyTable(
      this.schemaName,
      this.tableName,
      col(this.columnName, this.type, { notNull: true }),
      this.checkType,
      lowerer,
    );
  }

  renderTypeScript(): string {
    return `this.addRequiredColumnToEmptyTable({ ${[
      ...columnCallLocation(this.schemaName, this.tableName, this.columnName),
      `type: ${jsonToTsSource(this.type)}`,
    ].join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

/**
 * Adds a required column with no default to a table that may have rows: the column is added with
 * `temporaryDefault`, a SQL value every existing row takes, and the default is then dropped.
 */
export class AddColumnWithTemporaryDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addColumnWithTemporaryDefault' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  /** The column's type as a migration writes it. */
  readonly type: string;
  /** SQL for the value existing rows take, such as `''` or `0`. */
  readonly temporaryDefault: string;
  /** The type `format_type` prints for `type`, or `undefined` when the stack's data types do not read it. */
  readonly checkType: ColumnTypeCheck | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    type: string,
    temporaryDefault: string,
    dataTypes: readonly DataType[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.type = type;
    this.temporaryDefault = temporaryDefault;
    this.checkType = columnTypeCheckIfReadable(type, dataTypes);
    const refused = checkSqlDefaultText(temporaryDefault);
    if (refused !== undefined) {
      const call = `addColumnWithTemporaryDefault({ ${columnCallLocation(schemaName, tableName, columnName).join(', ')} })`;
      throw postgresError(
        'CONTRACT.DEFAULT_INVALID',
        `${call}: temporaryDefault ${JSON.stringify(temporaryDefault)} is not a value: ${refused}`,
        {
          fix: "Write temporaryDefault as one SQL value, such as '' or 0.",
          meta: { expression: temporaryDefault, where: call },
        },
      );
    }
    this.label = `Add column ${columnName} to ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw postgresError(
        'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
        `AddColumnWithTemporaryDefaultCall.toOp: a lowerer is required on the Postgres planner path (column "${this.columnName}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
        { meta: { factory: 'AddColumnWithTemporaryDefaultCall' } },
      );
    }
    return buildAddNotNullColumnWithTemporaryDefaultOperation({
      schema: this.schemaName,
      tableName: this.tableName,
      columnName: this.columnName,
      type: this.type,
      checkType: this.checkType,
      temporaryDefault: this.temporaryDefault,
      lowerer,
    });
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const source = `this.addColumnWithTemporaryDefault({ ${[
      ...columnCallLocation(this.schemaName, this.tableName, this.columnName),
      `type: ${jsonToTsSource(this.type)}`,
      `temporaryDefault: ${sql.source(this.temporaryDefault)}`,
    ].join(', ')} })`;
    return { source, imports: sql.imports() };
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
  readonly operationClass = 'widening' as const;
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
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const source = `this.addCheckConstraint({ ${constraintCallOptions(this.schemaName, this.tableName, this.constraintName)}, expression: ${sql.source(this.expression)} })`;
    return { source, imports: sql.imports() };
  }
}

export class DropCheckConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropCheckConstraint' as const;
  readonly operationClass = 'widening' as const;
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
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`index: ${jsonToTsSource(this.indexName)}`);
    if (this.columns !== undefined) {
      opts.push(`columns: ${jsonToTsSource(this.columns)}`);
    } else {
      opts.push(`expression: ${sql.source(this.expression ?? '')}`);
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
      if (this.where !== undefined) extrasParts.push(`where: ${sql.source(this.where)}`);
      if (this.unique) extrasParts.push('unique: true');
      opts.push(`extras: { ${extrasParts.join(', ')} }`);
    }
    return { source: `this.createIndex({ ${opts.join(', ')} })`, imports: sql.imports() };
  }
}

export class RenameIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameIndex' as const;
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
  readonly operationClass = 'widening' as const;
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
  readonly schemaName: string;
  readonly extensionName: string;
  readonly label: string;

  constructor(schemaName: string, extensionName: string) {
    super();
    this.schemaName = schemaName;
    this.extensionName = extensionName;
    this.label = `Create extension "${extensionName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return createExtension(
      { schema: this.schemaName, extension: this.extensionName },
      requireLowerer(lowerer, 'CreateExtensionCall', `extension "${this.extensionName}"`),
    );
  }

  renderTypeScript(): string {
    return `this.createExtension({ schema: ${jsonToTsSource(this.schemaName)}, extension: ${jsonToTsSource(this.extensionName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropExtensionCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropExtension' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly extensionName: string;
  readonly label: string;

  constructor(schemaName: string, extensionName: string) {
    super();
    this.schemaName = schemaName;
    this.extensionName = extensionName;
    this.label = `Drop extension "${extensionName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return dropExtension(
      { schema: this.schemaName, extension: this.extensionName },
      requireLowerer(lowerer, 'DropExtensionCall', `extension "${this.extensionName}"`),
    );
  }

  renderTypeScript(): string {
    return `this.dropExtension({ schema: ${jsonToTsSource(this.schemaName)}, extension: ${jsonToTsSource(this.extensionName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class SetExtensionSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setExtensionSchema' as const;
  readonly operationClass = 'widening' as const;
  readonly extensionName: string;
  readonly toSchemaName: string;
  readonly label: string;

  constructor(extensionName: string, toSchemaName: string) {
    super();
    this.extensionName = extensionName;
    this.toSchemaName = toSchemaName;
    this.label = `Move extension "${extensionName}" to schema "${toSchemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return setExtensionSchema(
      { extension: this.extensionName, schema: this.toSchemaName },
      requireLowerer(lowerer, 'SetExtensionSchemaCall', `extension "${this.extensionName}"`),
    );
  }

  renderTypeScript(): string {
    return `this.setExtensionSchema({ extension: ${jsonToTsSource(this.extensionName)}, schema: ${jsonToTsSource(this.toSchemaName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class CreateSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createSchema' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly label: string;
  readonly companions: readonly [] = [];

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

function requireLowerer(
  lowerer: ExecuteRequestLowerer | undefined,
  factory: string,
  subject: string,
): ExecuteRequestLowerer {
  if (lowerer === undefined) {
    throw postgresError(
      'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
      `${factory}.toOp: a lowerer is required on the Postgres planner path (${subject}). Pass the control adapter to createPostgresMigrationPlanner.`,
      { meta: { factory } },
    );
  }
  return lowerer;
}

export class SetTableSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setTableSchema' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly toSchemaName: string;
  readonly label: string;
  readonly companions: readonly [] = [];

  constructor(schemaName: string, tableName: string, toSchemaName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.toSchemaName = toSchemaName;
    this.label = `Move table "${tableName}" to schema "${toSchemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return setTableSchema(
      this.schemaName,
      this.tableName,
      this.toSchemaName,
      requireLowerer(lowerer, 'SetTableSchemaCall', `table "${this.tableName}"`),
    );
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`to: ${jsonToTsSource(this.toSchemaName)}`);
    return `this.setTableSchema({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class RenameSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameSchema' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly toSchemaName: string;
  readonly label: string;
  readonly companions: readonly [] = [];

  constructor(schemaName: string, toSchemaName: string) {
    super();
    this.schemaName = schemaName;
    this.toSchemaName = toSchemaName;
    this.label = `Rename schema "${schemaName}" to "${toSchemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return renameSchema(
      this.schemaName,
      this.toSchemaName,
      requireLowerer(lowerer, 'RenameSchemaCall', `schema "${this.schemaName}"`),
    );
  }

  renderTypeScript(): string {
    return `this.renameSchema({ schema: ${jsonToTsSource(this.schemaName)}, to: ${jsonToTsSource(this.toSchemaName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

export class DropSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropSchema' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly label: string;

  constructor(schemaName: string) {
    super();
    this.schemaName = schemaName;
    this.label = `Drop schema "${schemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    return dropSchema(
      this.schemaName,
      requireLowerer(lowerer, 'DropSchemaCall', `schema "${this.schemaName}"`),
    );
  }

  renderTypeScript(): string {
    return `this.dropSchema({ schema: ${jsonToTsSource(this.schemaName)} })`;
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
  readonly operationClass = 'widening' as const;
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
        step(
          `ensure enum type "${typeName}" exists`,
          typePresent.sql,
          typePresent.params,
          expectPresent(`enum type "${typeName}"`),
        ),
        step(
          `ensure value "${value}" is absent from enum type "${typeName}"`,
          valueAbsent.sql,
          valueAbsent.params,
          expectAbsent(`value "${value}" in enum type "${typeName}"`),
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
          expectPresent(`value "${value}" in enum type "${typeName}"`),
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
// Stored values
// ============================================================================

function replaceStoredValueSource(
  location: readonly string[],
  from: string,
  to: string,
  many: boolean,
  codec: StoredValueCodec | undefined,
): string {
  const opts = [
    ...location,
    `from: ${from}`,
    `to: ${to}`,
    ...(many ? ['many: true'] : []),
    ...codecRefSource(codec),
  ];
  return `this.replaceStoredValue({ ${opts.join(', ')} })`;
}

function codecRefSource(codec: StoredValueCodec | undefined): readonly string[] {
  return codec === undefined ? [] : [`codecRef: ${jsonToTsSource(codec.codecRef)}`];
}

function requireStoredValue(
  value: string | number,
  factory: string,
  location: readonly string[],
  argument: string,
): string | number {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return value;
  }
  const got: unknown = value;
  throw postgresError(
    'CONTRACT.ARGUMENT_INVALID',
    `${factory}({ ${location.join(', ')} }): ${argument} must be a string or a number; got ${typeof got === 'number' || got === undefined ? String(got) : JSON.stringify(got)}`,
    { meta: { what: `${factory} ${argument}` } },
  );
}

/** Changes one stored value of a column to another, in every row, or in every list of a list column. */
export class ReplaceStoredValueCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'replaceStoredValue' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly from: string | number;
  readonly to: string | number;
  readonly many: boolean;
  /** The column's codec, which writes `from` and `to` as the database stores them. */
  readonly codec: StoredValueCodec | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    from: string | number,
    to: string | number,
    many: boolean,
    codec?: StoredValueCodec,
  ) {
    super();
    const location = columnCallLocation(schemaName, tableName, columnName);
    this.codec = codec;
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.from = requireStoredValue(from, this.factoryName, location, 'from');
    this.to = requireStoredValue(to, this.factoryName, location, 'to');
    this.many = many;
    this.label = `Replace value ${storedValueText(from)} with ${storedValueText(to)} in column "${columnName}" of "${tableName}"`;
    this.freeze();
  }

  async toOp(): Promise<Op> {
    return replaceStoredValue(
      this.schemaName,
      this.tableName,
      this.columnName,
      await encodeStoredValue(this.from, this.codec),
      await encodeStoredValue(this.to, this.codec),
      this.many,
    );
  }

  renderTypeScript(): string {
    return replaceStoredValueSource(
      columnCallLocation(this.schemaName, this.tableName, this.columnName),
      jsonToTsSource(this.from),
      jsonToTsSource(this.to),
      this.many,
      this.codec,
    );
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

/** Removes one stored value of a column: sets it to NULL, or takes it out of every list of a list column. */
export class RemoveStoredValueCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'removeStoredValue' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly value: string | number;
  readonly many: boolean;
  /** The column's codec, which writes `value` as the database stores it. */
  readonly codec: StoredValueCodec | undefined;
  /** The enum value whose stored value is removed, which the check that fails while rows of a required column hold it names. */
  readonly enumValue: EnumValueCoordinateJson | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    value: string | number,
    many: boolean,
    codec?: StoredValueCodec,
    enumValue?: EnumValueCoordinateJson,
  ) {
    super();
    this.codec = codec;
    this.enumValue = enumValue;
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.value = requireStoredValue(
      value,
      this.factoryName,
      columnCallLocation(schemaName, tableName, columnName),
      'value',
    );
    this.many = many;
    this.label = `Remove value ${storedValueText(value)} from column "${columnName}" of "${tableName}"`;
    this.freeze();
  }

  async toOp(): Promise<Op> {
    return removeStoredValue(
      this.schemaName,
      this.tableName,
      this.columnName,
      await encodeStoredValue(this.value, this.codec),
      this.many,
      this.enumValue === undefined
        ? undefined
        : {
            enumValue: this.enumValue,
            value: this.value,
            ...(this.codec === undefined ? {} : { codecRef: this.codec.codecRef }),
          },
    );
  }

  renderTypeScript(): string {
    const opts = [
      ...columnCallLocation(this.schemaName, this.tableName, this.columnName),
      `value: ${jsonToTsSource(this.value)}`,
      ...(this.many ? ['many: true'] : []),
      ...codecRefSource(this.codec),
      ...(this.enumValue === undefined ? [] : [`enumValue: ${jsonToTsSource(this.enumValue)}`]),
    ];
    return `this.removeStoredValue({ ${opts.join(', ')} })`;
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
 * to the user via `placeholder("…")` calls. `toOp()` always rejects with
 * `MIGRATION.UNFILLED_PLACEHOLDER`: the planner cannot lower a stubbed transform to a runtime
 * op — the user must fill the rendered `migration.ts` and re-emit.
 */
export class DataTransformCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly checkSlot: string;
  readonly runSlot: string;
  readonly backfillsColumn: DataTransformColumn | undefined;

  constructor(
    label: string,
    checkSlot: string,
    runSlot: string,
    operationClass: MigrationOperationClass = 'data',
    backfillsColumn?: DataTransformColumn,
  ) {
    super();
    this.label = label;
    this.checkSlot = checkSlot;
    this.runSlot = runSlot;
    this.operationClass = operationClass;
    this.backfillsColumn = backfillsColumn;
    this.freeze();
  }

  toOp(): Promise<Op> {
    return unfilledPlaceholderOperation(this.label);
  }

  renderTypeScript(): string {
    return [
      `this.dataTransform(endContract, ${jsonToTsSource(this.label)}, {`,
      ...(this.backfillsColumn === undefined
        ? []
        : [`  backfillsColumn: ${jsonToTsSource(this.backfillsColumn).replaceAll('\n', '\n  ')},`]),
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
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(POSTGRES_MIGRATION_FACADE);
    const p = this.policy;
    // `input` and `sources` are typed against the parameter `createRlsPolicy`
    // accepts, so a drift between the renderer and the API, including a field
    // the renderer does not write, is a compile error here rather than in the
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
    const sources: { readonly [K in keyof RenderedRlsPolicyLiteral]-?: string | undefined } = {
      naming: jsonToTsSource(input.naming),
      tableName: jsonToTsSource(input.tableName),
      namespaceId: jsonToTsSource(input.namespaceId),
      operation: jsonToTsSource(input.operation),
      roles: jsonToTsSource(input.roles),
      using: input.using === undefined ? undefined : sql.source(input.using),
      withCheck: input.withCheck === undefined ? undefined : sql.source(input.withCheck),
      permissive: jsonToTsSource(input.permissive),
    };
    const policy = tsObjectSource(
      Object.entries(sources).flatMap(([key, source]) =>
        source === undefined ? [] : [[key, source] as const],
      ),
    );
    const source = `this.createRlsPolicy({ schema: ${jsonToTsSource(this.schemaName)}, table: ${jsonToTsSource(this.tableName)}, policy: ${policy} })`;
    return { source, imports: sql.imports() };
  }
}

export class DropPostgresRlsPolicyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropRlsPolicy' as const;
  readonly operationClass = 'widening' as const;
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
  readonly operationClass = 'widening' as const;
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
  | RenameColumnCall
  | DropColumnCall
  | AlterColumnTypeCall
  | SetNotNullCall
  | DropNotNullCall
  | SetDefaultCall
  | DropDefaultCall
  | AddRequiredColumnToEmptyTableCall
  | AddColumnWithTemporaryDefaultCall
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
  | DropExtensionCall
  | SetExtensionSchemaCall
  | CreateSchemaCall
  | SetTableSchemaCall
  | RenameSchemaCall
  | DropSchemaCall
  | CreateNativeEnumTypeCall
  | DropNativeEnumTypeCall
  | AddNativeEnumValueCall
  | ReplaceStoredValueCall
  | RemoveStoredValueCall
  | CreatePostgresRlsPolicyCall
  | DropPostgresRlsPolicyCall
  | EnableRowLevelSecurityCall
  | DisableRowLevelSecurityCall
  | RenamePostgresRlsPolicyCall
  | DataTransformCall;

/** The name of the column a call acts on: its `columnName`, or the name of the column it carries. */
export function columnNameOfCall(call: PostgresOpFactoryCall): string | undefined {
  if ('columnName' in call) return call.columnName;
  if ('column' in call && call.column instanceof DdlColumn) return call.column.name;
  return undefined;
}
