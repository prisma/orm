import {
  type DdlColumn,
  type DdlTableConstraint,
  opaqueSql,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import {
  AddColumnAction,
  type AnyAlterTableAction,
  type CreateIndexElements,
  DropDefaultAction,
  PostgresAlterIndexRename,
  PostgresAlterPolicyRename,
  PostgresAlterTable,
  PostgresCreateIndex,
  PostgresCreatePolicy,
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresCreateType,
  PostgresDisableRowLevelSecurity,
  PostgresDropIndex,
  PostgresDropPolicy,
  PostgresDropType,
  type RlsPolicyOperation,
} from '../core/ddl/nodes';

/**
 * Build a Postgres `CREATE TABLE` query node.
 *
 * Pass `constraints` for table-level composite primary keys, foreign keys, and
 * unique constraints — use the {@link PrimaryKeyConstraint}, {@link ForeignKeyConstraint},
 * and {@link UniqueConstraint} classes from `@internal/sql-relational-core/ast`.
 *
 * Precondition: identifiers (`table`, `schema`, column names/types) are
 * emitted to SQL verbatim — they are not quoted or escaped, so callers must
 * pass pre-trusted values (e.g. fixed control-plane identifiers). String-literal
 * default values, by contrast, are single-quote-escaped (embedded `'` doubled)
 * by the renderer. Identifier quoting for untrusted identifiers is added when
 * the migration planner adopts this lowering path.
 */
export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
  readonly constraints?: readonly DdlTableConstraint[];
}): PostgresCreateTable {
  return new PostgresCreateTable(options);
}

/**
 * Build a Postgres `CREATE SCHEMA` query node. See {@link createTable} for the
 * pre-trusted-identifier precondition.
 */
export function createSchema(options: {
  readonly schema: string;
  readonly ifNotExists?: boolean;
}): PostgresCreateSchema {
  return new PostgresCreateSchema(options);
}

/**
 * Build a Postgres `CREATE TYPE … AS ENUM (…)` DDL node. The type name (and
 * optional schema) are quoted by the renderer; the enum member `values` are
 * emitted as single-quote-escaped string literals. An absent `schema` renders
 * the type name unqualified so the connection's `search_path` resolves it.
 */
export function createType(options: {
  readonly schema?: string;
  readonly name: string;
  readonly values: readonly string[];
}): PostgresCreateType {
  return new PostgresCreateType(options);
}

/**
 * Build a Postgres `DROP TYPE` DDL node. See {@link createType} for the
 * identifier-quoting and unqualified-when-schemaless behaviour.
 */
export function dropType(options: {
  readonly schema?: string;
  readonly name: string;
}): PostgresDropType {
  return new PostgresDropType(options);
}

/**
 * Build an `ADD COLUMN` action for use inside {@link alterTable}.
 * The column is a structured `DdlColumn` so codec-encoded defaults flow
 * through the adapter's `pgRenderDdlColumn` → `pgRenderDdlColumnDefault` path.
 */
export function addColumnAction(column: DdlColumn): AddColumnAction {
  return new AddColumnAction(column);
}

/**
 * Build a `DROP DEFAULT` action (`ALTER COLUMN "<name>" DROP DEFAULT`) for
 * use inside {@link alterTable}. The renderer quotes the column name.
 */
export function dropDefaultAction(columnName: string): DropDefaultAction {
  return new DropDefaultAction(columnName);
}

/**
 * Build a Postgres `ALTER TABLE` query node carrying one or more actions.
 * See {@link addColumnAction} / {@link dropDefaultAction} for building actions.
 */
export function alterTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly actions: readonly AnyAlterTableAction[];
}): PostgresAlterTable {
  return new PostgresAlterTable(options);
}

/**
 * Build a Postgres `CREATE POLICY` DDL node.
 *
 * Identifiers (`schema`, `table`, `name`) are quoted by the renderer.
 * `using` and `withCheck` are emitted verbatim as predicate SQL — callers
 * must supply safe, pre-validated SQL expressions.
 */
export function createPolicy(options: {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly permissive: boolean;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
}): PostgresCreatePolicy {
  const { using, withCheck, ...rest } = options;
  return new PostgresCreatePolicy({
    ...rest,
    ...ifDefined('using', using === undefined ? undefined : opaqueSql(using)),
    ...ifDefined('withCheck', withCheck === undefined ? undefined : opaqueSql(withCheck)),
  });
}

/**
 * Build a Postgres `DROP POLICY` DDL node.
 * Identifiers (`schema`, `table`, `name`) are quoted by the renderer.
 */
export function dropPolicy(options: {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
}): PostgresDropPolicy {
  return new PostgresDropPolicy(options);
}

/**
 * Build a Postgres `ALTER POLICY … RENAME TO` DDL node.
 * Identifiers (`schema`, `table`, `name`, `newName`) are quoted by the renderer.
 */
export function alterPolicyRename(options: {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly newName: string;
}): PostgresAlterPolicyRename {
  return new PostgresAlterPolicyRename(options);
}

/**
 * Build a Postgres `CREATE [UNIQUE] INDEX` DDL node. Identifiers (`schema`,
 * `table`, `name`, column elements, `type`, option keys) are quoted by the
 * renderer; the `expression` element list and the `where` predicate are
 * inserted verbatim (opaque SQL). An absent `schema` renders the object
 * names unqualified (the unbound namespace).
 */
export function createIndex(options: {
  readonly schema: string | undefined;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly elements: CreateIndexElements;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  readonly where: string | undefined;
}): PostgresCreateIndex {
  const { elements, where, ...rest } = options;
  return new PostgresCreateIndex({
    ...rest,
    elements:
      'columns' in elements
        ? { columns: elements.columns }
        : { expression: opaqueSql(elements.expression) },
    where: where === undefined ? undefined : opaqueSql(where),
  });
}

/**
 * Build a Postgres `DROP INDEX` DDL node. The index name (and optional
 * schema) are quoted by the renderer.
 */
export function dropIndex(options: {
  readonly schema: string | undefined;
  readonly name: string;
}): PostgresDropIndex {
  return new PostgresDropIndex(options);
}

/**
 * Build a Postgres `ALTER INDEX … RENAME TO` DDL node. Identifiers are
 * quoted by the renderer.
 */
export function alterIndexRename(options: {
  readonly schema: string | undefined;
  readonly from: string;
  readonly to: string;
}): PostgresAlterIndexRename {
  return new PostgresAlterIndexRename(options);
}

/**
 * Build a Postgres `ALTER TABLE … DISABLE ROW LEVEL SECURITY` DDL node.
 * Identifiers (`schema`, `table`) are quoted by the renderer.
 */
export function disableRowLevelSecurity(options: {
  readonly schema: string;
  readonly table: string;
}): PostgresDisableRowLevelSecurity {
  return new PostgresDisableRowLevelSecurity(options);
}
