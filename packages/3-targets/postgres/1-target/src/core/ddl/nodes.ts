import {
  type DdlColumn,
  DdlNode,
  type DdlTableConstraint,
  type OpaqueSql,
} from '@internal/sql-relational-core/ast';
import type { RlsPolicyOperation } from '../rls/canonicalize';

// ---------------------------------------------------------------------------
// AlterTableAction — nested polymorphic hierarchy
// ---------------------------------------------------------------------------

export interface AlterTableActionVisitor<R> {
  addColumn(action: AddColumnAction): R;
  dropDefault(action: DropDefaultAction): R;
  addConstraint(action: AddConstraintAction): R;
  alterColumnType(action: AlterColumnTypeAction): R;
}

export abstract class AlterTableAction {
  abstract readonly kind: string;
  abstract accept<R>(visitor: AlterTableActionVisitor<R>): R;
}

export class AddColumnAction extends AlterTableAction {
  readonly kind = 'add-column' as const;
  readonly column: DdlColumn;

  constructor(column: DdlColumn) {
    super();
    this.column = column;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.addColumn(this);
  }
}

export class DropDefaultAction extends AlterTableAction {
  readonly kind = 'drop-default' as const;
  readonly columnName: string;

  constructor(columnName: string) {
    super();
    this.columnName = columnName;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.dropDefault(this);
  }
}

export class AddConstraintAction extends AlterTableAction {
  readonly kind = 'add-constraint' as const;
  readonly constraint: DdlTableConstraint;

  constructor(constraint: DdlTableConstraint) {
    super();
    this.constraint = constraint;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.addConstraint(this);
  }
}

/**
 * `ALTER COLUMN "<columnName>" TYPE <type> USING <using>`. `type` is written as given. Without `using`, the conversion is `"<columnName>"::<type>`.
 */
export class AlterColumnTypeAction extends AlterTableAction {
  readonly kind = 'alter-column-type' as const;
  readonly columnName: string;
  readonly type: string;
  readonly using: OpaqueSql | undefined;

  constructor(options: {
    readonly columnName: string;
    readonly type: string;
    readonly using: OpaqueSql | undefined;
  }) {
    super();
    this.columnName = options.columnName;
    this.type = options.type;
    this.using = options.using;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.alterColumnType(this);
  }
}

/**
 * The ALTER TABLE subactions expressible as typed DDL. Other ALTER TABLE statements, such as the primary key, unique and foreign key `ADD CONSTRAINT` in `operations/constraints.ts` and the remaining column actions in `operations/columns.ts`, are built as template strings.
 */
export type AnyAlterTableAction =
  | AddColumnAction
  | DropDefaultAction
  | AddConstraintAction
  | AlterColumnTypeAction;

// ---------------------------------------------------------------------------
// Top-level DDL visitor
// ---------------------------------------------------------------------------

export interface PostgresDdlVisitor<R> {
  createTable(node: PostgresCreateTable): R;
  createSchema(node: PostgresCreateSchema): R;
  createType(node: PostgresCreateType): R;
  dropType(node: PostgresDropType): R;
  alterTable(node: PostgresAlterTable): R;
  createPolicy(node: PostgresCreatePolicy): R;
  dropPolicy(node: PostgresDropPolicy): R;
  alterPolicyRename(node: PostgresAlterPolicyRename): R;
  createIndex(node: PostgresCreateIndex): R;
  dropIndex(node: PostgresDropIndex): R;
  alterIndexRename(node: PostgresAlterIndexRename): R;
  disableRowLevelSecurity(node: PostgresDisableRowLevelSecurity): R;
  alterTableSetSchema(node: PostgresAlterTableSetSchema): R;
  alterSchemaRename(node: PostgresAlterSchemaRename): R;
  dropSchema(node: PostgresDropSchema): R;
}

export abstract class PostgresDdlNode extends DdlNode {
  abstract accept<R>(visitor: PostgresDdlVisitor<R>): R;
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze([...columns]);
}

function freezeConstraints(
  constraints: readonly DdlTableConstraint[] | undefined,
): ReadonlyArray<DdlTableConstraint> | undefined {
  return constraints ? Object.freeze([...constraints]) : undefined;
}

export class PostgresCreateTable extends PostgresDdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly ifNotExists: boolean | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;
  readonly constraints: ReadonlyArray<DdlTableConstraint> | undefined;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.columns = freezeDdlColumns(options.columns);
    this.constraints = freezeConstraints(options.constraints);
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export class PostgresCreateSchema extends PostgresDdlNode {
  readonly kind = 'create-schema' as const;
  readonly schema: string;
  readonly ifNotExists: boolean | undefined;

  constructor(options: { readonly schema: string; readonly ifNotExists?: boolean }) {
    super();
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createSchema(this);
  }
}

export class PostgresCreateType extends PostgresDdlNode {
  readonly kind = 'create-type' as const;
  readonly schema: string | undefined;
  readonly name: string;
  readonly values: ReadonlyArray<string>;

  constructor(options: {
    readonly schema?: string;
    readonly name: string;
    readonly values: readonly string[];
  }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.values = Object.freeze([...options.values]);
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createType(this);
  }
}

export class PostgresDropType extends PostgresDdlNode {
  readonly kind = 'drop-type' as const;
  readonly schema: string | undefined;
  readonly name: string;

  constructor(options: { readonly schema?: string; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.dropType(this);
  }
}

export class PostgresAlterTable extends PostgresDdlNode {
  readonly kind = 'alter-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly actions: ReadonlyArray<AnyAlterTableAction>;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly actions: readonly AnyAlterTableAction[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.actions = Object.freeze([...options.actions]);
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterTable(this);
  }
}

export type { RlsPolicyOperation };

export class PostgresCreatePolicy extends PostgresDdlNode {
  readonly kind = 'create-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly permissive: boolean;
  readonly operation: RlsPolicyOperation;
  readonly roles: ReadonlyArray<string>;
  readonly using: OpaqueSql | undefined;
  readonly withCheck: OpaqueSql | undefined;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly permissive: boolean;
    readonly operation: RlsPolicyOperation;
    readonly roles: readonly string[];
    readonly using?: OpaqueSql;
    readonly withCheck?: OpaqueSql;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.permissive = options.permissive;
    this.operation = options.operation;
    this.roles = Object.freeze([...options.roles]);
    this.using = options.using;
    this.withCheck = options.withCheck;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createPolicy(this);
  }
}

export class PostgresDropPolicy extends PostgresDdlNode {
  readonly kind = 'drop-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;

  constructor(options: { readonly schema: string; readonly table: string; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.dropPolicy(this);
  }
}

export class PostgresAlterPolicyRename extends PostgresDdlNode {
  readonly kind = 'alter-policy-rename' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly newName: string;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly newName: string;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.newName = options.newName;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterPolicyRename(this);
  }
}

/**
 * The element list between the parens of CREATE INDEX, as a migration file writes it: either a column tuple or one SQL expression string covering the entire list.
 */
export type CreateIndexElements =
  | { readonly columns: readonly string[] }
  | { readonly expression: string };

/**
 * The element list between the parens of CREATE INDEX: either a column tuple (each identifier quoted by the renderer) or one `OpaqueSql` value covering the entire list.
 */
export type DdlIndexElements =
  | { readonly columns: readonly string[] }
  | { readonly expression: OpaqueSql };

export class PostgresCreateIndex extends PostgresDdlNode {
  readonly kind = 'create-index' as const;
  /** Absent ⇔ unqualified (the unbound namespace — `search_path` decides). */
  readonly schema: string | undefined;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly elements: DdlIndexElements;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  /** Partial-index predicate (WHERE body, without the keyword). Never quoted or escaped. */
  readonly where: OpaqueSql | undefined;

  constructor(options: {
    readonly schema: string | undefined;
    readonly table: string;
    readonly name: string;
    readonly unique: boolean;
    readonly elements: DdlIndexElements;
    readonly type: string | undefined;
    readonly options: Record<string, unknown> | undefined;
    readonly where: OpaqueSql | undefined;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.unique = options.unique;
    this.elements =
      'columns' in options.elements
        ? { columns: Object.freeze([...options.elements.columns]) }
        : { expression: options.elements.expression };
    this.type = options.type;
    this.options = options.options;
    this.where = options.where;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

export class PostgresDropIndex extends PostgresDdlNode {
  readonly kind = 'drop-index' as const;
  /** Absent ⇔ unqualified (the unbound namespace). */
  readonly schema: string | undefined;
  readonly name: string;

  constructor(options: { readonly schema: string | undefined; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}

export class PostgresAlterIndexRename extends PostgresDdlNode {
  readonly kind = 'alter-index-rename' as const;
  /** Absent ⇔ unqualified (the unbound namespace). */
  readonly schema: string | undefined;
  readonly from: string;
  readonly to: string;

  constructor(options: {
    readonly schema: string | undefined;
    readonly from: string;
    readonly to: string;
  }) {
    super();
    this.schema = options.schema;
    this.from = options.from;
    this.to = options.to;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterIndexRename(this);
  }
}

export class PostgresDisableRowLevelSecurity extends PostgresDdlNode {
  readonly kind = 'disable-row-level-security' as const;
  readonly schema: string;
  readonly table: string;

  constructor(options: { readonly schema: string; readonly table: string }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.disableRowLevelSecurity(this);
  }
}

export class PostgresAlterTableSetSchema extends PostgresDdlNode {
  readonly kind = 'alter-table-set-schema' as const;
  /** Absent ⇔ unqualified (the unbound namespace). */
  readonly schema: string | undefined;
  readonly table: string;
  readonly to: string;

  constructor(options: {
    readonly schema: string | undefined;
    readonly table: string;
    readonly to: string;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.to = options.to;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterTableSetSchema(this);
  }
}

export class PostgresAlterSchemaRename extends PostgresDdlNode {
  readonly kind = 'alter-schema-rename' as const;
  readonly schema: string;
  readonly to: string;

  constructor(options: { readonly schema: string; readonly to: string }) {
    super();
    this.schema = options.schema;
    this.to = options.to;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterSchemaRename(this);
  }
}

export class PostgresDropSchema extends PostgresDdlNode {
  readonly kind = 'drop-schema' as const;
  readonly schema: string;

  constructor(options: { readonly schema: string }) {
    super();
    this.schema = options.schema;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.dropSchema(this);
  }
}

export type AnyPostgresDdlNode =
  | PostgresCreateTable
  | PostgresCreateSchema
  | PostgresCreateType
  | PostgresDropType
  | PostgresAlterTable
  | PostgresCreatePolicy
  | PostgresDropPolicy
  | PostgresAlterPolicyRename
  | PostgresCreateIndex
  | PostgresDropIndex
  | PostgresAlterIndexRename
  | PostgresDisableRowLevelSecurity
  | PostgresAlterTableSetSchema
  | PostgresAlterSchemaRename
  | PostgresDropSchema;
