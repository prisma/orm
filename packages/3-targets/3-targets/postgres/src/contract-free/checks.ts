import type { SelectAst } from '@internal/sql-relational-core/ast';
import {
  type CfExpr,
  type CfExprSelectQuery,
  cfExpr,
  cfTable,
  exprSelect,
} from '@internal/sql-relational-core/contract-free';
import { PostgresTableSource } from '../core/ast/table-source';
import { PG_BOOL_CODEC_ID, PG_TEXT_CODEC_ID } from '../core/codec-ids';
import { postgresCreateNamespace } from '../core/postgres-schema';

/**
 * `to_regclass($1)` with the qualified table name bound as a text parameter.
 * Thin vocabulary wrapper over the core `cfExpr.fn` helper — the target
 * supplies only the template and the codec'd operand.
 */
export function toRegclass(qualifiedName: string): CfExpr {
  return cfExpr.fn({
    method: 'to_regclass',
    template: 'to_regclass({{self}})',
    self: cfExpr.param(qualifiedName, PG_TEXT_CODEC_ID),
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
}

export interface TableExistsCheckBuilder {
  tableAbsent(): SelectAst;
  tablePresent(): SelectAst;
}

/**
 * Typed builder for the migration planner's table-existence checks. Produces
 * FROM-less `SELECT to_regclass($1) IS [NOT] NULL AS "result"` ASTs with the
 * qualified table name bound as a text parameter — never inlined into the SQL.
 *
 * `schema` is a namespace coordinate: the framework `__unbound__` sentinel
 * elides the qualifier (search_path decides at runtime); any other id
 * qualifies as `"schema"."table"`.
 */
export function tableExistsAst(schema: string, table: string): TableExistsCheckBuilder {
  const qualified = postgresCreateNamespace({ id: schema, entries: { table: {} } }).qualifyTable(
    table,
  );
  const regclass = toRegclass(qualified);
  return {
    tableAbsent: () => exprSelect().project('result', regclass.isNull()).build(),
    tablePresent: () => exprSelect().project('result', regclass.isNotNull()).build(),
  };
}

export interface ConstraintExistsCheckBuilder {
  constraintPresent(): SelectAst;
  constraintAbsent(): SelectAst;
}

/**
 * Typed builder for the migration planner's constraint-existence checks.
 * Produces `SELECT [NOT ]EXISTS (SELECT 1 FROM pg_constraint c JOIN
 * pg_namespace n ON n.oid = c.connamespace WHERE c.conname = $1 AND
 * n.nspname = $2 [AND c.conrelid = to_regclass($3)]) AS "result"` with the
 * constraint name, schema name, and qualified table name bound as text
 * parameters.
 *
 * When `table` is omitted the check matches by name + schema across all
 * tables. Pass `table` to scope the check to a single table (prevents false
 * matches on identically-named constraints in different tables). `schema`
 * is a namespace coordinate: the `__unbound__` sentinel compares `nspname`
 * against `current_schema()` instead of a bound parameter.
 */
export function constraintExistsAst(options: {
  readonly constraintName: string;
  readonly schema: string;
  readonly table?: string;
}): ConstraintExistsCheckBuilder {
  const namespace = postgresCreateNamespace({ id: options.schema, entries: { table: {} } });
  const conditions = [
    cfExpr.columnRef('c', 'conname').eqParam(options.constraintName, PG_TEXT_CODEC_ID),
    cfExpr.columnRef('n', 'nspname').eqExpr(namespace.schemaFilterExpression()),
  ];
  if (options.table !== undefined) {
    conditions.push(
      cfExpr.columnRef('c', 'conrelid').eqExpr(toRegclass(namespace.qualifyTable(options.table))),
    );
  }
  const inner = (): CfExprSelectQuery =>
    exprSelect()
      .from(cfTable('pg_constraint', 'c'))
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace')),
      )
      .project('one', cfExpr.lit(1))
      .where(cfExpr.allOf(conditions));
  return {
    constraintPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    constraintAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

function checkNamespace(schema: string) {
  return postgresCreateNamespace({ id: schema, entries: { table: {} } });
}

function informationSchemaColumns(): PostgresTableSource {
  return new PostgresTableSource({ schema: 'information_schema', name: 'columns' });
}

function infoSchemaColumnConditions(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): CfExpr[] {
  return [
    cfExpr
      .identifierRef('table_schema')
      .eqExpr(checkNamespace(options.schema).schemaFilterExpression()),
    cfExpr.identifierRef('table_name').eqParam(options.table, PG_TEXT_CODEC_ID),
    cfExpr.identifierRef('column_name').eqParam(options.column, PG_TEXT_CODEC_ID),
  ];
}

function infoSchemaColumnQuery(conditions: ReadonlyArray<CfExpr>): CfExprSelectQuery {
  return exprSelect()
    .from(informationSchemaColumns())
    .project('one', cfExpr.lit(1))
    .where(cfExpr.allOf(conditions));
}

export interface ColumnExistsCheckBuilder {
  columnPresent(): SelectAst;
  columnAbsent(): SelectAst;
}

/**
 * Typed builder for column-existence checks over
 * `information_schema.columns`, with schema, table, and column names bound
 * as text parameters.
 */
export function columnExistsAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): ColumnExistsCheckBuilder {
  const inner = () => infoSchemaColumnQuery(infoSchemaColumnConditions(options));
  return {
    columnPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    columnAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

/**
 * Typed nullability check: EXISTS over `information_schema.columns` with
 * `is_nullable` compared against the bound `'YES'` / `'NO'` marker.
 */
export function columnNullabilityAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly nullable: boolean;
}): SelectAst {
  const conditions = [
    ...infoSchemaColumnConditions(options),
    cfExpr.identifierRef('is_nullable').eqParam(options.nullable ? 'YES' : 'NO', PG_TEXT_CODEC_ID),
  ];
  return exprSelect()
    .project('result', cfExpr.exists(infoSchemaColumnQuery(conditions)))
    .build();
}

export interface ColumnDefaultCheckBuilder {
  defaultPresent(): SelectAst;
  defaultAbsent(): SelectAst;
  noDefault(): SelectAst;
}

/**
 * Typed default-presence checks over `information_schema.columns`.
 * `defaultPresent` / `defaultAbsent` assert the column row exists with a
 * non-null / null `column_default`; `noDefault` is the NOT EXISTS variant
 * (also true when the column row is missing entirely).
 */
export function columnDefaultAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): ColumnDefaultCheckBuilder {
  const withDefault = () =>
    infoSchemaColumnQuery([
      ...infoSchemaColumnConditions(options),
      cfExpr.identifierRef('column_default').isNotNull(),
    ]);
  const withoutDefault = () =>
    infoSchemaColumnQuery([
      ...infoSchemaColumnConditions(options),
      cfExpr.identifierRef('column_default').isNull(),
    ]);
  return {
    defaultPresent: () => exprSelect().project('result', cfExpr.exists(withDefault())).build(),
    defaultAbsent: () => exprSelect().project('result', cfExpr.exists(withoutDefault())).build(),
    noDefault: () => exprSelect().project('result', cfExpr.notExists(withDefault())).build(),
  };
}

/**
 * Typed check that a column takes its default from a sequence attached to it: `pg_get_serial_sequence` finds a sequence owned by the column, and `information_schema.columns` shows a `nextval(` default. Either half alone holds after a default was dropped or replaced, so a setDefault that attaches a sequence checks both.
 */
export function columnDefaultSequenceAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): SelectAst {
  const attachedSequence = cfExpr.fn({
    method: 'pg_get_serial_sequence',
    template: 'pg_get_serial_sequence({{self}}, {{arg0}})',
    self: cfExpr.param(
      checkNamespace(options.schema).qualifyTable(options.table),
      PG_TEXT_CODEC_ID,
    ),
    args: [cfExpr.param(options.column, PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
  const nextvalDefault = cfExpr.fn({
    method: 'starts_with',
    template: 'starts_with({{self}}, {{arg0}})',
    self: cfExpr.identifierRef('column_default'),
    args: [cfExpr.param('nextval(', PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_BOOL_CODEC_ID, nullable: true },
  });
  const columnWithNextvalDefault = infoSchemaColumnQuery([
    ...infoSchemaColumnConditions(options),
    nextvalDefault,
  ]);
  return exprSelect()
    .project('result', attachedSequence.isNotNull().and(cfExpr.exists(columnWithNextvalDefault)))
    .build();
}

/**
 * Typed column-type check: EXISTS over `pg_attribute` joined to `pg_class`
 * and `pg_namespace`, comparing `format_type(a.atttypid, a.atttypmod)`
 * against the bound expected display type and excluding dropped columns.
 */
export function columnTypeAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly expectedType: string;
}): SelectAst {
  const formatType = cfExpr.fn({
    method: 'format_type',
    template: 'format_type({{self}}, {{arg0}})',
    self: cfExpr.columnRef('a', 'atttypid'),
    args: [cfExpr.columnRef('a', 'atttypmod')],
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: false },
  });
  const inner = exprSelect()
    .from(cfTable('pg_attribute', 'a'))
    .join(
      cfTable('pg_class', 'c'),
      cfExpr.columnRef('c', 'oid').eqExpr(cfExpr.columnRef('a', 'attrelid')),
    )
    .join(
      cfTable('pg_namespace', 'n'),
      cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'relnamespace')),
    )
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr
          .columnRef('n', 'nspname')
          .eqExpr(checkNamespace(options.schema).schemaFilterExpression()),
        cfExpr.columnRef('c', 'relname').eqParam(options.table, PG_TEXT_CODEC_ID),
        cfExpr.columnRef('a', 'attname').eqParam(options.column, PG_TEXT_CODEC_ID),
        formatType.eqParam(options.expectedType, PG_TEXT_CODEC_ID),
        cfExpr.columnRef('a', 'attisdropped').not(),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

export interface TablePrimaryKeyCheckBuilder {
  pkPresent(): SelectAst;
  pkAbsent(): SelectAst;
}

/**
 * Typed primary-key existence check over `pg_index` joined to `pg_class`
 * and `pg_namespace`, with a LEFT JOIN on the index relation so an
 * optional `constraintName` can scope the match to a named constraint.
 */
export function tablePrimaryKeyAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly constraintName?: string;
}): TablePrimaryKeyCheckBuilder {
  const conditions = [
    cfExpr
      .columnRef('n', 'nspname')
      .eqExpr(checkNamespace(options.schema).schemaFilterExpression()),
    cfExpr.columnRef('c', 'relname').eqParam(options.table, PG_TEXT_CODEC_ID),
    cfExpr.columnRef('i', 'indisprimary'),
  ];
  if (options.constraintName !== undefined) {
    conditions.push(
      cfExpr.columnRef('c2', 'relname').eqParam(options.constraintName, PG_TEXT_CODEC_ID),
    );
  }
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_index', 'i'))
      .join(
        cfTable('pg_class', 'c'),
        cfExpr.columnRef('c', 'oid').eqExpr(cfExpr.columnRef('i', 'indrelid')),
      )
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'relnamespace')),
      )
      .leftJoin(
        cfTable('pg_class', 'c2'),
        cfExpr.columnRef('c2', 'oid').eqExpr(cfExpr.columnRef('i', 'indexrelid')),
      )
      .project('one', cfExpr.lit(1))
      .where(cfExpr.allOf(conditions));
  return {
    pkPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    pkAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

/**
 * Typed emptiness check: NOT EXISTS over the user table itself with
 * `LIMIT 1`. The table is addressed through the namespace's polymorphic
 * `tableSource` (qualified for named schemas, bare for the unbound slot).
 */
export function tableIsEmptyAst(schema: string, table: string): SelectAst {
  const inner = exprSelect()
    .from(checkNamespace(schema).tableSource(table))
    .project('one', cfExpr.lit(1))
    .limit(1);
  return exprSelect().project('result', cfExpr.notExists(inner)).build();
}

/**
 * Typed no-NULL-values data check used by `SET NOT NULL` prechecks:
 * NOT EXISTS over the user table where the column IS NULL.
 */
export function noNullValuesAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): SelectAst {
  const inner = exprSelect()
    .from(checkNamespace(options.schema).tableSource(options.table))
    .project('one', cfExpr.lit(1))
    .where(cfExpr.identifierRef(options.column).isNull());
  return exprSelect().project('result', cfExpr.notExists(inner)).build();
}

export interface ExtensionExistsCheckBuilder {
  extensionPresent(): SelectAst;
  extensionAbsent(): SelectAst;
}

/**
 * Typed extension existence check over `pg_extension`, with the extension
 * name bound as a text parameter.
 */
export function extensionExistsAst(extensionName: string): ExtensionExistsCheckBuilder {
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_extension'))
      .project('one', cfExpr.lit(1))
      .where(cfExpr.identifierRef('extname').eqParam(extensionName, PG_TEXT_CODEC_ID));
  return {
    extensionPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    extensionAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

export interface RlsPolicyExistsCheckBuilder {
  policyPresent(): SelectAst;
  policyAbsent(): SelectAst;
}

/**
 * Typed RLS-policy existence check over `pg_policies`, with schema, table,
 * and policy names bound as text parameters (never inlined). The `schema`
 * coordinate is the resolved live-database schema name (e.g. `'public'`),
 * compared against `pg_policies.schemaname` as a bound parameter.
 */
export function rlsPolicyExistsAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly policyName: string;
}): RlsPolicyExistsCheckBuilder {
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_policies'))
      .project('one', cfExpr.lit(1))
      .where(
        cfExpr.allOf([
          cfExpr.identifierRef('schemaname').eqParam(options.schema, PG_TEXT_CODEC_ID),
          cfExpr.identifierRef('tablename').eqParam(options.table, PG_TEXT_CODEC_ID),
          cfExpr.identifierRef('policyname').eqParam(options.policyName, PG_TEXT_CODEC_ID),
        ]),
      );
  return {
    policyPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    policyAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

export interface RlsEnabledCheckBuilder {
  rlsEnabled(): SelectAst;
  rlsDisabled(): SelectAst;
}

/**
 * Typed row-level-security enabled check over `pg_class` joined to
 * `pg_namespace`, comparing `pg_class.relrowsecurity` against the expected
 * boolean. Schema and table names are bound as text parameters.
 */
export function rlsEnabledAst(schema: string, table: string): RlsEnabledCheckBuilder {
  const inner = (enabled: boolean) =>
    exprSelect()
      .from(cfTable('pg_class', 'c'))
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'relnamespace')),
      )
      .project('one', cfExpr.lit(1))
      .where(
        cfExpr.allOf([
          cfExpr.columnRef('n', 'nspname').eqParam(schema, PG_TEXT_CODEC_ID),
          cfExpr.columnRef('c', 'relname').eqParam(table, PG_TEXT_CODEC_ID),
          enabled
            ? cfExpr.columnRef('c', 'relrowsecurity')
            : cfExpr.columnRef('c', 'relrowsecurity').not(),
        ]),
      );
  return {
    rlsEnabled: () =>
      exprSelect()
        .project('result', cfExpr.exists(inner(true)))
        .build(),
    rlsDisabled: () =>
      exprSelect()
        .project('result', cfExpr.exists(inner(false)))
        .build(),
  };
}

export interface IndexExistsCheckBuilder {
  indexPresent(): SelectAst;
  indexAbsent(): SelectAst;
}

/**
 * Typed index existence check riding the same `to_regclass` vocabulary as
 * `tableExistsAst`, with the qualified index name bound as a text parameter.
 */
export function indexExistsAst(schema: string, indexName: string): IndexExistsCheckBuilder {
  const regclass = toRegclass(checkNamespace(schema).qualifyTable(indexName));
  return {
    indexPresent: () => exprSelect().project('result', regclass.isNotNull()).build(),
    indexAbsent: () => exprSelect().project('result', regclass.isNull()).build(),
  };
}

export interface NativeEnumTypeExistsCheckBuilder {
  typePresent(): SelectAst;
  typeAbsent(): SelectAst;
}

/**
 * Typed native-enum type existence check over `pg_type` joined to
 * `pg_namespace`, restricted to enum types (`typtype = 'e'`). Schema and
 * type name are bound as text parameters; `schema` is a namespace
 * coordinate (the `__unbound__` sentinel compares against
 * `current_schema()`), matching {@link tableExistsAst} et al.
 */
export function nativeEnumTypeExistsAst(
  schema: string,
  typeName: string,
): NativeEnumTypeExistsCheckBuilder {
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_type', 't'))
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('t', 'typnamespace')),
      )
      .project('one', cfExpr.lit(1))
      .where(
        cfExpr.allOf([
          cfExpr.columnRef('n', 'nspname').eqExpr(checkNamespace(schema).schemaFilterExpression()),
          cfExpr.columnRef('t', 'typname').eqParam(typeName, PG_TEXT_CODEC_ID),
          cfExpr.columnRef('t', 'typtype').eqParam('e', PG_TEXT_CODEC_ID),
        ]),
      );
  return {
    typePresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    typeAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

export interface NativeEnumValueExistsCheckBuilder {
  valuePresent(): SelectAst;
  valueAbsent(): SelectAst;
}

/**
 * Typed native-enum member-value existence check over `pg_enum` joined to
 * `pg_type` and `pg_namespace`. Schema, type name, and the candidate member
 * value are bound as text parameters — used by `addNativeEnumValue`'s
 * precheck (value absent) and postcheck (value present).
 */
export function nativeEnumValueExistsAst(options: {
  readonly schema: string;
  readonly typeName: string;
  readonly value: string;
}): NativeEnumValueExistsCheckBuilder {
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_enum', 'e'))
      .join(
        cfTable('pg_type', 't'),
        cfExpr.columnRef('t', 'oid').eqExpr(cfExpr.columnRef('e', 'enumtypid')),
      )
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('t', 'typnamespace')),
      )
      .project('one', cfExpr.lit(1))
      .where(
        cfExpr.allOf([
          cfExpr
            .columnRef('n', 'nspname')
            .eqExpr(checkNamespace(options.schema).schemaFilterExpression()),
          cfExpr.columnRef('t', 'typname').eqParam(options.typeName, PG_TEXT_CODEC_ID),
          cfExpr.columnRef('e', 'enumlabel').eqParam(options.value, PG_TEXT_CODEC_ID),
        ]),
      );
  return {
    valuePresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    valueAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}
