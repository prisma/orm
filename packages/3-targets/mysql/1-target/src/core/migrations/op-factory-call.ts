import {
  createSqlTextSources,
  type MigrationOperationClass,
  type SqlTextSources,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { OpFactoryCall } from '@internal/framework-components/control';
import type { ReferentialAction } from '@internal/sql-contract/types';
import type {
  AnyDdlColumnDefault,
  DdlColumn,
  DdlTableConstraint,
} from '@internal/sql-relational-core/ast';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@internal/ts-render';
import { ifDefined } from '@internal/utils/defined';
import { createTable } from '../../contract-free/ddl';
import { mysqlError } from '../errors';
import { quoteIdentifier } from '../sql-utils';
import {
  columnChecks,
  columnDefinitionSql,
  columnList,
  constraintChecks,
  foreignKeyActionsSql,
  indexChecks,
  type Op,
  step,
  tableChecks,
} from './operations';
import { buildTargetDetails } from './planner-target-details';

const TARGET_MIGRATION_MODULE = '@internal/mysql/migration';

/** The refusal of a `MysqlMigration` operation that needs the control adapter, on an instance built without a control stack. */
export function mysqlMigrationStackMissing(operation: string) {
  return mysqlError(
    'MIGRATION.MYSQL_CONTROL_STACK_MISSING',
    `MysqlMigration.${operation} requires a control adapter`,
    {
      why: `MysqlMigration.${operation} was invoked on an instance constructed without a ControlStack, so it cannot render its DDL.`,
      fix: 'Construct the migration via the migration CLI entrypoint, which assembles a ControlStack from prisma.config.ts, or pass a ControlStack with a MySQL adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}

abstract class MysqlOpFactoryCallNode extends TsExpression implements OpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(lowerer?: ExecuteRequestLowerer): Op | Promise<Op>;

  importRequirements(): readonly ImportRequirement[] {
    return [];
  }

  protected freeze(): void {
    Object.freeze(this);
  }

  protected lowererFor(lowerer: ExecuteRequestLowerer | undefined): ExecuteRequestLowerer {
    if (lowerer === undefined) throw mysqlMigrationStackMissing(this.factoryName);
    return lowerer;
  }
}

export type { MysqlOpFactoryCallNode };

/** Whether `call` is one of this target's calls. */
export function isMysqlOpFactoryCall(call: OpFactoryCall): call is MysqlOpFactoryCallNode {
  return call instanceof MysqlOpFactoryCallNode;
}

function renderColumnDefault(def: AnyDdlColumnDefault, sql: SqlTextSources): string {
  return def.kind === 'literal'
    ? `lit(${jsonToTsSource(def.value)})`
    : `fn(${sql.source(def.expression.text)})`;
}

function renderColumn(column: DdlColumn, sql: SqlTextSources): string {
  const options = [
    ...(column.notNull ? ['notNull: true'] : []),
    ...(column.default === undefined
      ? []
      : [`default: ${renderColumnDefault(column.default, sql)}`]),
    ...(column.codecRef === undefined ? [] : [`codecRef: ${jsonToTsSource(column.codecRef)}`]),
  ];
  const optionsSource = options.length > 0 ? `, { ${options.join(', ')} }` : '';
  return `col(${jsonToTsSource(column.name)}, ${jsonToTsSource(column.type)}${optionsSource})`;
}

function renderConstraint(constraint: DdlTableConstraint): string {
  const named =
    constraint.name === undefined ? '' : `, { name: ${jsonToTsSource(constraint.name)} }`;
  switch (constraint.kind) {
    case 'primary-key':
      return `primaryKey(${jsonToTsSource(constraint.columns)}${named})`;
    case 'unique':
      return `unique(${jsonToTsSource(constraint.columns)}${named})`;
    case 'foreign-key':
    case 'check-expression':
      throw mysqlError(
        'CONTRACT.CONSTRAINT_INVALID',
        `The MySQL createTable call writes primary keys and unique constraints only; add ${constraint.kind === 'foreign-key' ? 'a foreign key with addForeignKey' : 'no CHECK constraint'} (constraint "${constraint.name ?? ''}").`,
        { meta: { constraintKind: constraint.kind } },
      );
  }
}

function columnImports(columns: readonly DdlColumn[]): ImportRequirement[] {
  const symbols = new Set<string>(columns.length > 0 ? ['col'] : []);
  for (const column of columns) {
    if (column.default?.kind === 'literal') symbols.add('lit');
    if (column.default?.kind === 'function') symbols.add('fn');
  }
  return [...symbols].map((symbol) => ({ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol }));
}

interface WrittenCall {
  readonly source: string;
  readonly imports: readonly ImportRequirement[];
}

export class CreateTableCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;
  readonly columns: readonly DdlColumn[];
  readonly constraints: readonly DdlTableConstraint[];

  constructor(
    readonly tableName: string,
    columns: readonly DdlColumn[],
    constraints: readonly DdlTableConstraint[],
  ) {
    super();
    this.columns = Object.freeze([...columns]);
    this.constraints = Object.freeze([...constraints]);
    this.label = `Create table ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    const statement = await this.lowererFor(lowerer).lowerToExecuteRequest(
      createTable({ table: this.tableName, columns: this.columns, constraints: this.constraints }),
    );
    const table = tableChecks(this.tableName);
    return {
      id: `table.${this.tableName}`,
      label: this.label,
      summary: `Creates table ${this.tableName} with its columns, primary key and unique constraints`,
      operationClass: 'additive',
      target: { id: 'mysql', details: buildTargetDetails('table', this.tableName) },
      precheck: [table.absent(`ensure table "${this.tableName}" does not exist`)],
      execute: [step(`create table "${this.tableName}"`, statement.sql, statement.params)],
      postcheck: [table.present(`verify table "${this.tableName}" exists`)],
    };
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(TARGET_MIGRATION_MODULE);
    const columns = this.columns.map((column) => renderColumn(column, sql)).join(', ');
    const constraints = this.constraints.map(renderConstraint);
    const source = `this.createTable({ table: ${jsonToTsSource(this.tableName)}, columns: [${columns}]${constraints.length > 0 ? `, constraints: [${constraints.join(', ')}]` : ''} })`;
    const constraintImports = [
      ...new Set(this.constraints.map((c) => (c.kind === 'primary-key' ? 'primaryKey' : 'unique'))),
    ].map((symbol) => ({ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol }));
    return {
      source,
      imports: [...columnImports(this.columns), ...constraintImports, ...sql.imports()],
    };
  }
}

export class DropTableCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'dropTable' as const;
  readonly operationClass = 'destructive' as const;
  readonly label: string;

  constructor(readonly tableName: string) {
    super();
    this.label = `Drop table ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const table = tableChecks(this.tableName);
    return {
      id: `dropTable.${this.tableName}`,
      label: this.label,
      summary: `Drops table ${this.tableName} which is not in the contract`,
      operationClass: 'destructive',
      target: { id: 'mysql', details: buildTargetDetails('table', this.tableName) },
      precheck: [table.present(`ensure table "${this.tableName}" exists`)],
      execute: [
        step(`drop table "${this.tableName}"`, `DROP TABLE ${quoteIdentifier(this.tableName)}`),
      ],
      postcheck: [table.absent(`verify table "${this.tableName}" is gone`)],
    };
  }

  renderTypeScript(): string {
    return `this.dropTable({ table: ${jsonToTsSource(this.tableName)} })`;
  }
}

export class AddColumnCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'addColumn' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;
  readonly columnName: string;

  constructor(
    readonly tableName: string,
    readonly column: DdlColumn,
  ) {
    super();
    this.columnName = column.name;
    this.label = `Add column ${column.name} on ${tableName}`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    const definition = await columnDefinitionSql(
      this.column,
      this.tableName,
      this.lowererFor(lowerer),
    );
    const column = columnChecks(this.tableName, this.columnName);
    return {
      id: `column.${this.tableName}.${this.columnName}`,
      label: this.label,
      summary: `Adds column ${this.columnName} to ${this.tableName}`,
      operationClass: 'additive',
      target: {
        id: 'mysql',
        details: buildTargetDetails('column', this.columnName, this.tableName),
      },
      precheck: [
        tableChecks(this.tableName).present(`ensure table "${this.tableName}" exists`),
        column.absent(`ensure column "${this.columnName}" is missing on "${this.tableName}"`),
      ],
      execute: [
        step(
          `add column "${this.columnName}" to "${this.tableName}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} ADD COLUMN ${definition}`,
        ),
      ],
      postcheck: [
        column.present(`verify column "${this.columnName}" exists on "${this.tableName}"`),
      ],
    };
  }

  renderTypeScript(): string {
    return this.#written().source;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return this.#written().imports;
  }

  #written(): WrittenCall {
    const sql = createSqlTextSources(TARGET_MIGRATION_MODULE);
    const source = `this.addColumn({ table: ${jsonToTsSource(this.tableName)}, column: ${renderColumn(this.column, sql)} })`;
    return { source, imports: [...columnImports([this.column]), ...sql.imports()] };
  }
}

export class DropColumnCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'dropColumn' as const;
  readonly operationClass = 'destructive' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly columnName: string,
  ) {
    super();
    this.label = `Drop column ${columnName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const column = columnChecks(this.tableName, this.columnName);
    return {
      id: `dropColumn.${this.tableName}.${this.columnName}`,
      label: this.label,
      summary: `Drops column ${this.columnName} on ${this.tableName} which is not in the contract`,
      operationClass: 'destructive',
      target: {
        id: 'mysql',
        details: buildTargetDetails('column', this.columnName, this.tableName),
      },
      precheck: [
        column.present(`ensure column "${this.columnName}" exists on "${this.tableName}"`),
      ],
      execute: [
        step(
          `drop column "${this.columnName}" from "${this.tableName}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} DROP COLUMN ${quoteIdentifier(this.columnName)}`,
        ),
      ],
      postcheck: [
        column.absent(`verify column "${this.columnName}" is gone from "${this.tableName}"`),
      ],
    };
  }

  renderTypeScript(): string {
    return `this.dropColumn({ table: ${jsonToTsSource(this.tableName)}, column: ${jsonToTsSource(this.columnName)} })`;
  }
}

export class CreateIndexCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly indexName: string,
    readonly columns: readonly string[],
    readonly unique: boolean,
  ) {
    super();
    this.label = `Create ${unique ? 'unique ' : ''}index ${indexName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const index = indexChecks(this.tableName, this.indexName);
    return {
      id: `index.${this.tableName}.${this.indexName}`,
      label: this.label,
      summary: `Creates ${this.unique ? 'unique ' : ''}index ${this.indexName} on ${this.tableName}`,
      operationClass: 'additive',
      target: {
        id: 'mysql',
        details: buildTargetDetails('index', this.indexName, this.tableName),
      },
      precheck: [index.absent(`ensure index "${this.indexName}" is missing`)],
      execute: [
        step(
          `create index "${this.indexName}"`,
          `CREATE ${this.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(this.indexName)} ON ${quoteIdentifier(this.tableName)} (${columnList(this.columns)})`,
        ),
      ],
      postcheck: [index.present(`verify index "${this.indexName}" exists`)],
    };
  }

  renderTypeScript(): string {
    return `this.createIndex({ table: ${jsonToTsSource(this.tableName)}, index: ${jsonToTsSource(this.indexName)}, columns: ${jsonToTsSource(this.columns)}${this.unique ? ', unique: true' : ''} })`;
  }
}

export class DropIndexCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'widening' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly indexName: string,
  ) {
    super();
    this.label = `Drop index ${indexName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const index = indexChecks(this.tableName, this.indexName);
    return {
      id: `dropIndex.${this.tableName}.${this.indexName}`,
      label: this.label,
      summary: `Drops index ${this.indexName} on ${this.tableName} which is not in the contract`,
      operationClass: 'widening',
      target: {
        id: 'mysql',
        details: buildTargetDetails('index', this.indexName, this.tableName),
      },
      precheck: [index.present(`ensure index "${this.indexName}" exists`)],
      execute: [
        step(
          `drop index "${this.indexName}"`,
          `DROP INDEX ${quoteIdentifier(this.indexName)} ON ${quoteIdentifier(this.tableName)}`,
        ),
      ],
      postcheck: [index.absent(`verify index "${this.indexName}" is gone`)],
    };
  }

  renderTypeScript(): string {
    return `this.dropIndex({ table: ${jsonToTsSource(this.tableName)}, index: ${jsonToTsSource(this.indexName)} })`;
  }
}

export class AddUniqueCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'addUnique' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly constraintName: string,
    readonly columns: readonly string[],
  ) {
    super();
    this.label = `Add unique constraint ${constraintName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const constraint = constraintChecks(this.tableName, this.constraintName, 'UNIQUE');
    return {
      id: `unique.${this.tableName}.${this.constraintName}`,
      label: this.label,
      summary: `Adds unique constraint ${this.constraintName} on ${this.tableName}`,
      operationClass: 'additive',
      target: {
        id: 'mysql',
        details: buildTargetDetails('unique', this.constraintName, this.tableName),
      },
      precheck: [constraint.absent(`ensure unique constraint "${this.constraintName}" is missing`)],
      execute: [
        step(
          `add unique constraint "${this.constraintName}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} ADD CONSTRAINT ${quoteIdentifier(this.constraintName)} UNIQUE (${columnList(this.columns)})`,
        ),
      ],
      postcheck: [constraint.present(`verify unique constraint "${this.constraintName}" exists`)],
    };
  }

  renderTypeScript(): string {
    return `this.addUnique({ table: ${jsonToTsSource(this.tableName)}, name: ${jsonToTsSource(this.constraintName)}, columns: ${jsonToTsSource(this.columns)} })`;
  }
}

export class DropUniqueCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'dropUnique' as const;
  readonly operationClass = 'widening' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly constraintName: string,
  ) {
    super();
    this.label = `Drop unique constraint ${constraintName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const constraint = constraintChecks(this.tableName, this.constraintName, 'UNIQUE');
    return {
      id: `dropUnique.${this.tableName}.${this.constraintName}`,
      label: this.label,
      summary: `Drops unique constraint ${this.constraintName} on ${this.tableName} which is not in the contract`,
      operationClass: 'widening',
      target: {
        id: 'mysql',
        details: buildTargetDetails('unique', this.constraintName, this.tableName),
      },
      precheck: [constraint.present(`ensure unique constraint "${this.constraintName}" exists`)],
      execute: [
        step(
          `drop unique constraint "${this.constraintName}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} DROP INDEX ${quoteIdentifier(this.constraintName)}`,
        ),
      ],
      postcheck: [constraint.absent(`verify unique constraint "${this.constraintName}" is gone`)],
    };
  }

  renderTypeScript(): string {
    return `this.dropUnique({ table: ${jsonToTsSource(this.tableName)}, name: ${jsonToTsSource(this.constraintName)} })`;
  }
}

/** A foreign key as `addForeignKey` takes it. */
export interface MysqlForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: { readonly table: string; readonly columns: readonly string[] };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export class AddForeignKeyCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'addForeignKey' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly foreignKey: MysqlForeignKeySpec,
  ) {
    super();
    this.label = `Add foreign key ${foreignKey.name} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const { name, columns, references } = this.foreignKey;
    const constraint = constraintChecks(this.tableName, name, 'FOREIGN KEY');
    return {
      id: `foreignKey.${this.tableName}.${name}`,
      label: this.label,
      summary: `Adds foreign key ${name} on ${this.tableName} referencing ${references.table}`,
      operationClass: 'additive',
      target: {
        id: 'mysql',
        details: buildTargetDetails('foreignKey', name, this.tableName),
      },
      precheck: [constraint.absent(`ensure foreign key "${name}" is missing`)],
      execute: [
        step(
          `add foreign key "${name}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} ADD CONSTRAINT ${quoteIdentifier(name)} FOREIGN KEY (${columnList(columns)}) REFERENCES ${quoteIdentifier(references.table)} (${columnList(references.columns)})${foreignKeyActionsSql(this.foreignKey)}`,
        ),
      ],
      postcheck: [constraint.present(`verify foreign key "${name}" exists`)],
    };
  }

  renderTypeScript(): string {
    const { name, columns, references, onDelete, onUpdate } = this.foreignKey;
    const fields = [
      `table: ${jsonToTsSource(this.tableName)}`,
      `name: ${jsonToTsSource(name)}`,
      `columns: ${jsonToTsSource(columns)}`,
      `references: ${jsonToTsSource(references)}`,
      ...(onDelete === undefined ? [] : [`onDelete: ${jsonToTsSource(onDelete)}`]),
      ...(onUpdate === undefined ? [] : [`onUpdate: ${jsonToTsSource(onUpdate)}`]),
    ];
    return `this.addForeignKey({ ${fields.join(', ')} })`;
  }
}

export class DropForeignKeyCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'dropForeignKey' as const;
  readonly operationClass = 'widening' as const;
  readonly label: string;

  constructor(
    readonly tableName: string,
    readonly constraintName: string,
  ) {
    super();
    this.label = `Drop foreign key ${constraintName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    const constraint = constraintChecks(this.tableName, this.constraintName, 'FOREIGN KEY');
    return {
      id: `dropForeignKey.${this.tableName}.${this.constraintName}`,
      label: this.label,
      summary: `Drops foreign key ${this.constraintName} on ${this.tableName} which is not in the contract`,
      operationClass: 'widening',
      target: {
        id: 'mysql',
        details: buildTargetDetails('foreignKey', this.constraintName, this.tableName),
      },
      precheck: [constraint.present(`ensure foreign key "${this.constraintName}" exists`)],
      execute: [
        step(
          `drop foreign key "${this.constraintName}"`,
          `ALTER TABLE ${quoteIdentifier(this.tableName)} DROP FOREIGN KEY ${quoteIdentifier(this.constraintName)}`,
        ),
      ],
      postcheck: [constraint.absent(`verify foreign key "${this.constraintName}" is gone`)],
    };
  }

  renderTypeScript(): string {
    return `this.dropForeignKey({ table: ${jsonToTsSource(this.tableName)}, name: ${jsonToTsSource(this.constraintName)} })`;
  }
}

/** An operation built elsewhere, such as the table rename a user writes by hand, carried as it is and written as `rawSql({...})`. */
export class RawSqlCall extends MysqlOpFactoryCallNode {
  readonly factoryName = 'rawSql' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;

  constructor(readonly op: Op) {
    super();
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

  override importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: 'rawSql' }];
  }
}

/** The table rename a user writes by hand on MySQL, which the planner does not plan yet. */
export function renameTableByHandOp(from: string, to: string): Op {
  const fromTable = tableChecks(from);
  const toTable = tableChecks(to);
  return {
    id: `renameTable.${from}`,
    label: `Rename table ${from} to ${to}`,
    operationClass: 'widening',
    target: { id: 'mysql', details: buildTargetDetails('table', to) },
    precheck: [
      fromTable.present(`ensure table "${from}" exists`),
      toTable.absent(`ensure table "${to}" does not exist`),
    ],
    execute: [
      step(
        `rename table "${from}" to "${to}"`,
        `RENAME TABLE ${quoteIdentifier(from)} TO ${quoteIdentifier(to)}`,
      ),
    ],
    postcheck: [
      toTable.present(`verify table "${to}" exists`),
      fromTable.absent(`verify table "${from}" no longer exists`),
    ],
  };
}

export type MysqlOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | AddColumnCall
  | DropColumnCall
  | CreateIndexCall
  | DropIndexCall
  | AddUniqueCall
  | DropUniqueCall
  | AddForeignKeyCall
  | DropForeignKeyCall
  | RawSqlCall;

export function foreignKeySpecOf(
  fk: {
    readonly name?: string | undefined;
    readonly columns: readonly string[];
    readonly referencedTable: string;
    readonly referencedColumns: readonly string[];
    readonly onDelete?: ReferentialAction | undefined;
    readonly onUpdate?: ReferentialAction | undefined;
  },
  table: string,
): MysqlForeignKeySpec {
  return {
    name: fk.name ?? `${table}_${fk.columns.join('_')}_fkey`,
    columns: fk.columns,
    references: { table: fk.referencedTable, columns: fk.referencedColumns },
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
}
