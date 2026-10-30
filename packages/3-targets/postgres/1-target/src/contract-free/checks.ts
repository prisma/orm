import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
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
 * Typed check that a column takes its default from the sequence it owns: the column's default (`pg_attrdef`) depends on the sequence `pg_get_serial_sequence` finds for it. A `nextval(...)` default records that dependency on the sequence it reads, so a default that reads another sequence, an earlier default, or no default does not pass. It compares catalog identities, never the default's text.
 */
export function columnDefaultSequenceAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): SelectAst {
  const regclassOf = (catalog: string) =>
    cfExpr.raw(`'${catalog}'::regclass`, { codecId: PG_TEXT_CODEC_ID, nullable: false });
  const defaultOnOwnedSequence = exprSelect()
    .from(cfTable('pg_attrdef', 'd'))
    .join(
      cfTable('pg_attribute', 'a'),
      cfExpr
        .columnRef('a', 'attrelid')
        .eqExpr(cfExpr.columnRef('d', 'adrelid'))
        .and(cfExpr.columnRef('a', 'attnum').eqExpr(cfExpr.columnRef('d', 'adnum'))),
    )
    .join(
      cfTable('pg_depend', 'dep'),
      cfExpr.columnRef('dep', 'objid').eqExpr(cfExpr.columnRef('d', 'oid')),
    )
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr
          .columnRef('d', 'adrelid')
          .eqExpr(toRegclass(checkNamespace(options.schema).qualifyTable(options.table))),
        cfExpr.columnRef('a', 'attname').eqParam(options.column, PG_TEXT_CODEC_ID),
        cfExpr.columnRef('dep', 'classid').eqExpr(regclassOf('pg_attrdef')),
        cfExpr.columnRef('dep', 'refclassid').eqExpr(regclassOf('pg_class')),
        cfExpr.columnRef('dep', 'refobjid').eqExpr(ownedSequenceOf(options)),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(defaultOnOwnedSequence)).build();
}

/**
 * The sequence the column owns, as a `regclass`, found in the catalog with `pg_get_serial_sequence`; `NULL` when it owns none. A SERIAL column and an identity column both own one, and it keeps its name when the table or column is renamed.
 */
export function ownedSequenceOf(location: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}): CfExpr {
  return cfExpr.fn({
    method: 'pg_get_serial_sequence',
    template: 'pg_get_serial_sequence({{self}}, {{arg0}})::regclass',
    self: cfExpr.param(
      checkNamespace(location.schema).qualifyTable(location.table),
      PG_TEXT_CODEC_ID,
    ),
    args: [cfExpr.param(location.column, PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
}

/**
 * Typed check that a column's autoincrement default has a sequence to use: the column already owns one, whatever its name, or no relation has the name `sequence`, which the operation creates.
 */
export function sequenceNameAvailableAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly sequence: string;
}): SelectAst {
  const qualifiedSequence = checkNamespace(options.schema).qualifyTable(options.sequence);
  return exprSelect()
    .project(
      'result',
      ownedSequenceOf(options).isNotNull().or(toRegclass(qualifiedSequence).isNull()),
    )
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

/**
 * Typed check that an extension is installed in one schema: `pg_extension` joined to `pg_namespace`, with both names bound as text parameters.
 */
export function extensionInSchemaAst(extensionName: string, schema: string): SelectAst {
  const inner = exprSelect()
    .from(cfTable('pg_extension', 'e'))
    .join(
      cfTable('pg_namespace', 'n'),
      cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('e', 'extnamespace')),
    )
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.columnRef('e', 'extname').eqParam(extensionName, PG_TEXT_CODEC_ID),
        cfExpr.columnRef('n', 'nspname').eqParam(schema, PG_TEXT_CODEC_ID),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
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

/**
 * Whether the attribute numbers in `keys` (an `int2[]` or `int2vector` such as `pg_constraint.conkey` or `pg_index.indkey`) name, in order, exactly the columns `names` of the relation `relation`. Key `0`, an expression slot of an index, names no column.
 */
function keyColumnsAre(keys: CfExpr, relation: CfExpr, names: readonly string[]): CfExpr {
  return cfExpr.fn({
    method: 'key_columns_are',
    template:
      "(SELECT coalesce(jsonb_agg(key_attribute.attname ORDER BY key_column.position), '[]'::jsonb) FROM unnest({{self}}::int2[]) WITH ORDINALITY AS key_column(attnum, position) JOIN pg_attribute key_attribute ON key_attribute.attrelid = {{arg0}} AND key_attribute.attnum = key_column.attnum) = ({{arg1}})::jsonb",
    self: keys,
    args: [relation, cfExpr.param(JSON.stringify(names), PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
  });
}

/**
 * Typed check that the relation `name` exists and its `pg_class.relkind` is one of `kinds`, so a view, sequence or index of the same name does not pass as a table.
 */
export function relationKindAst(options: {
  readonly schema: string;
  readonly name: string;
  readonly kinds: readonly string[];
}): SelectAst {
  const relation = toRegclass(checkNamespace(options.schema).qualifyTable(options.name));
  const inner = exprSelect()
    .from(cfTable('pg_class', 'c'))
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.columnRef('c', 'oid').eqExpr(relation),
        options.kinds
          .map((kind) => cfExpr.columnRef('c', 'relkind').eqParam(kind, PG_TEXT_CODEC_ID))
          .reduce((either, kind) => either.or(kind)),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

export type ReferentialActionCode = 'a' | 'r' | 'c' | 'n' | 'd';

export interface ForeignKeyDefinition {
  readonly referencedSchema: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /** `pg_constraint.confdeltype`. */
  readonly onDelete: ReferentialActionCode;
  /** `pg_constraint.confupdtype`. */
  readonly onUpdate: ReferentialActionCode;
}

/**
 * Typed check that the constraint `constraintName` on `table` is of kind `contype` (`p`, `u`, `f` or `c`), on the columns `columns` in order when given, and for a foreign key, references `foreignKey`'s table and columns in order with its delete and update actions. It reads only catalog values, never the text Postgres prints for a constraint.
 */
export function constraintDefinitionAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly constraintName: string;
  readonly contype: 'p' | 'u' | 'f' | 'c';
  readonly columns?: readonly string[];
  readonly foreignKey?: ForeignKeyDefinition;
}): SelectAst {
  const namespace = checkNamespace(options.schema);
  const conditions = [
    cfExpr.columnRef('c', 'conname').eqParam(options.constraintName, PG_TEXT_CODEC_ID),
    cfExpr.columnRef('n', 'nspname').eqExpr(namespace.schemaFilterExpression()),
    cfExpr.columnRef('c', 'conrelid').eqExpr(toRegclass(namespace.qualifyTable(options.table))),
    cfExpr.columnRef('c', 'contype').eqParam(options.contype, PG_TEXT_CODEC_ID),
  ];
  if (options.columns !== undefined) {
    conditions.push(
      keyColumnsAre(
        cfExpr.columnRef('c', 'conkey'),
        cfExpr.columnRef('c', 'conrelid'),
        options.columns,
      ),
    );
  }
  const foreignKey = options.foreignKey;
  if (foreignKey !== undefined) {
    conditions.push(
      cfExpr
        .columnRef('c', 'confrelid')
        .eqExpr(
          toRegclass(
            checkNamespace(foreignKey.referencedSchema).qualifyTable(foreignKey.referencedTable),
          ),
        ),
      keyColumnsAre(
        cfExpr.columnRef('c', 'confkey'),
        cfExpr.columnRef('c', 'confrelid'),
        foreignKey.referencedColumns,
      ),
      cfExpr.columnRef('c', 'confdeltype').eqParam(foreignKey.onDelete, PG_TEXT_CODEC_ID),
      cfExpr.columnRef('c', 'confupdtype').eqParam(foreignKey.onUpdate, PG_TEXT_CODEC_ID),
    );
  }
  const inner = exprSelect()
    .from(cfTable('pg_constraint', 'c'))
    .join(
      cfTable('pg_namespace', 'n'),
      cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace')),
    )
    .project('one', cfExpr.lit(1))
    .where(cfExpr.allOf(conditions));
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

/**
 * Typed check that `index` is an index on `table` with the given uniqueness and access method, on the columns `columns` in order, and with or without a predicate. For an index written as an element list (`expression`) it checks no elements: the list can be a real expression, which Postgres stores in `indexprs`, or plain columns with a sort order, operator class or collation, which it stores as columns, and comparing its text would need the form Postgres prints.
 */
export function indexDefinitionAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly index: string;
  readonly unique: boolean;
  readonly method: string;
  readonly elements: { readonly columns: readonly string[] } | { readonly expression: true };
  readonly hasPredicate: boolean;
}): SelectAst {
  const namespace = checkNamespace(options.schema);
  const indexColumn = (name: string) => cfExpr.columnRef('i', name);
  const inner = exprSelect()
    .from(cfTable('pg_class', 'c'))
    .join(
      cfTable('pg_index', 'i'),
      cfExpr.columnRef('i', 'indexrelid').eqExpr(cfExpr.columnRef('c', 'oid')),
    )
    .join(
      cfTable('pg_am', 'm'),
      cfExpr.columnRef('m', 'oid').eqExpr(cfExpr.columnRef('c', 'relam')),
    )
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.columnRef('c', 'oid').eqExpr(toRegclass(namespace.qualifyTable(options.index))),
        cfExpr
          .columnRef('c', 'relkind')
          .eqParam('i', PG_TEXT_CODEC_ID)
          .or(cfExpr.columnRef('c', 'relkind').eqParam('I', PG_TEXT_CODEC_ID)),
        indexColumn('indrelid').eqExpr(toRegclass(namespace.qualifyTable(options.table))),
        options.unique ? indexColumn('indisunique') : indexColumn('indisunique').not(),
        cfExpr.columnRef('m', 'amname').eqParam(options.method, PG_TEXT_CODEC_ID),
        ...('columns' in options.elements
          ? [
              indexColumn('indexprs')
                .isNull()
                .and(
                  keyColumnsAre(
                    indexColumn('indkey'),
                    indexColumn('indrelid'),
                    options.elements.columns,
                  ),
                ),
            ]
          : []),
        options.hasPredicate ? indexColumn('indpred').isNotNull() : indexColumn('indpred').isNull(),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

/**
 * Typed check that the RLS policy `policyName` on `table` exists with the command `command` (as `pg_policies.cmd` prints it, such as `ALL` or `SELECT`), the permissive flag, and exactly the roles `roles`, in any order. A role written as `current_user`, `current_role` or `session_user` stands for the role it names in the session that runs the check, as `CREATE POLICY` resolves it. It never compares the policy's expressions.
 */
export function rlsPolicyDefinitionAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly policyName: string;
  readonly command: string;
  readonly permissive: boolean;
  readonly roles: readonly string[];
}): SelectAst {
  const rolesAre = cfExpr.fn({
    method: 'roles_are',
    template: `(SELECT coalesce(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb) FROM (SELECT DISTINCT policy_role::text COLLATE "C" AS role_name FROM unnest({{self}}) AS policy_role) AS actual_roles) = (SELECT coalesce(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb) FROM (SELECT DISTINCT (CASE expected_role WHEN 'current_user' THEN current_user::text WHEN 'current_role' THEN current_role::text WHEN 'session_user' THEN session_user::text ELSE expected_role END) COLLATE "C" AS role_name FROM jsonb_array_elements_text(({{arg0}})::jsonb) AS expected_role) AS expected_roles)`,
    self: cfExpr.identifierRef('roles'),
    args: [cfExpr.param(JSON.stringify(options.roles), PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
  });
  const inner = exprSelect()
    .from(cfTable('pg_policies'))
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.identifierRef('schemaname').eqParam(options.schema, PG_TEXT_CODEC_ID),
        cfExpr.identifierRef('tablename').eqParam(options.table, PG_TEXT_CODEC_ID),
        cfExpr.identifierRef('policyname').eqParam(options.policyName, PG_TEXT_CODEC_ID),
        cfExpr.identifierRef('cmd').eqParam(options.command, PG_TEXT_CODEC_ID),
        cfExpr
          .identifierRef('permissive')
          .eqParam(options.permissive ? 'PERMISSIVE' : 'RESTRICTIVE', PG_TEXT_CODEC_ID),
        rolesAre,
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

/**
 * Typed check that the column owns a sequence, whatever its name, of the type `sequenceType` (`smallint`, `integer` or `bigint`). With `orNone`, a column that owns no sequence passes too.
 */
export function columnOwnsSequenceAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly sequenceType: string;
  /** Whether a column that owns no sequence passes too. */
  readonly orNone: boolean;
}): SelectAst {
  const ownedSequence = ownedSequenceOf(options);
  const sequenceType = cfExpr.fn({
    method: 'to_regtype',
    template: 'to_regtype({{self}})',
    self: cfExpr.param(options.sequenceType, PG_TEXT_CODEC_ID),
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
  const sequenceOfType = exprSelect()
    .from(cfTable('pg_sequence', 's'))
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.columnRef('s', 'seqrelid').eqExpr(ownedSequence),
        cfExpr.columnRef('s', 'seqtypid').eqExpr(sequenceType),
      ]),
    );
  return exprSelect()
    .project(
      'result',
      options.orNone
        ? ownedSequence.isNull().or(cfExpr.exists(sequenceOfType))
        : ownedSequence.isNotNull().and(cfExpr.exists(sequenceOfType)),
    )
    .build();
}

/**
 * Typed column-type check by the type's identity: compares the column's `pg_attribute.atttypid` with `to_regtype(type)`, or with that type's array type for a list. It checks a type that claims a kind, such as an enum, whatever schema it is in, and a type the stack's data types do not read. `to_regtype` drops a type modifier, so `varchar(20)` matches any `varchar`.
 */
export function columnTypeOidAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly type: string;
  /** Whether the column holds a list of `type`, so its type is the array type of `type`. */
  readonly many: boolean;
}): SelectAst {
  const namespace = checkNamespace(options.schema);
  const expectedType = cfExpr.fn({
    method: 'to_regtype',
    template: options.many
      ? '(SELECT "t"."typarray" FROM "pg_catalog"."pg_type" AS "t" WHERE "t"."oid" = to_regtype({{self}}))'
      : 'to_regtype({{self}})',
    self: cfExpr.param(options.type, PG_TEXT_CODEC_ID),
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
  const inner = exprSelect()
    .from(cfTable('pg_attribute', 'a'))
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([
        cfExpr.columnRef('a', 'attrelid').eqExpr(toRegclass(namespace.qualifyTable(options.table))),
        cfExpr.columnRef('a', 'attname').eqParam(options.column, PG_TEXT_CODEC_ID),
        cfExpr.columnRef('a', 'atttypid').eqExpr(expectedType),
        cfExpr.columnRef('a', 'attisdropped').not(),
      ]),
    );
  return exprSelect().project('result', cfExpr.exists(inner)).build();
}

/**
 * Typed check that the sequence the column owns has handed out no value above `maxValue`, so narrowing it to a smaller integer type keeps every value it already gave. The sequence's position is read only when its current maximum is above `maxValue`, that is when the change narrows it, so widening needs no rights on the sequence. A sequence that has never been read, and a column that owns none, pass.
 */
export function sequenceValuesFitAst(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly maxValue: string;
}): SelectAst {
  const pastMax = cfExpr.fn({
    method: 'sequence_past_max',
    template:
      'CASE WHEN {{self}} <= ({{arg0}})::bigint THEN false ELSE coalesce(pg_sequence_last_value("s"."seqrelid"), 0) > ({{arg0}})::bigint END',
    self: cfExpr.columnRef('s', 'seqmax'),
    args: [cfExpr.param(options.maxValue, PG_TEXT_CODEC_ID)],
    returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
  });
  const narrowedPastMax = exprSelect()
    .from(cfTable('pg_sequence', 's'))
    .project('one', cfExpr.lit(1))
    .where(cfExpr.columnRef('s', 'seqrelid').eqExpr(ownedSequenceOf(options)).and(pastMax));
  return exprSelect().project('result', cfExpr.notExists(narrowedPastMax)).build();
}

export interface SchemaExistsCheckBuilder {
  schemaPresent(): SelectAst;
  schemaAbsent(): SelectAst;
}

/** Typed schema existence check over `pg_namespace`, with the schema name bound as a text parameter. */
export function schemaExistsAst(schema: string): SchemaExistsCheckBuilder {
  const inner = () =>
    exprSelect()
      .from(cfTable('pg_namespace'))
      .project('one', cfExpr.lit(1))
      .where(cfExpr.identifierRef('nspname').eqParam(schema, PG_TEXT_CODEC_ID));
  return {
    schemaPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    schemaAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}

function objectsInSchema(
  catalog: string,
  namespaceColumn: string,
  schema: string,
  only: readonly CfExpr[] = [],
): CfExprSelectQuery {
  return exprSelect()
    .from(cfTable(catalog, 'o'))
    .join(
      cfTable('pg_namespace', 'n'),
      cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('o', namespaceColumn)),
    )
    .project('one', cfExpr.lit(1))
    .where(
      cfExpr.allOf([cfExpr.columnRef('n', 'nspname').eqParam(schema, PG_TEXT_CODEC_ID), ...only]),
    );
}

/**
 * Whether a schema holds no relations (tables, views, sequences, indexes), no types of its own and
 * no functions, so `DROP SCHEMA` without `CASCADE` succeeds. A table's row type and an array type
 * belong to another object and are not counted.
 */
export function schemaHoldsNoObjectsAst(schema: string): SelectAst {
  return exprSelect()
    .project(
      'result',
      cfExpr.allOf([
        cfExpr.notExists(objectsInSchema('pg_class', 'relnamespace', schema)),
        cfExpr.notExists(
          objectsInSchema('pg_type', 'typnamespace', schema, [
            cfExpr.columnRef('o', 'typrelid').eqLit(0),
            cfExpr.columnRef('o', 'typelem').eqLit(0),
          ]),
        ),
        cfExpr.notExists(objectsInSchema('pg_proc', 'pronamespace', schema)),
      ]),
    )
    .build();
}

/**
 * After a table of the unbound namespace moves to `toSchema`: the search path finds no table of that
 * name, or finds only the moved one, which it does when `toSchema` is on the search path.
 */
export function unboundTableMovedAst(table: string, toSchema: string): SelectAst {
  const found = toRegclass(checkNamespace(UNBOUND_NAMESPACE_ID).qualifyTable(table));
  const moved = toRegclass(checkNamespace(toSchema).qualifyTable(table));
  return exprSelect()
    .project('result', found.isNull().or(found.eqExpr(moved)))
    .build();
}
