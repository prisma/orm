import type { JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/runtime';
import {
  type AggregateExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyJsonValueProjection,
  type AnyParamRef,
  type AnyQueryAst,
  type BinaryExpr,
  type CaseExpr,
  type CastExpr,
  type ColumnRef,
  collectOrderedParamRefs,
  type DeleteAst,
  type FunctionCallExpr,
  type InsertAst,
  type InsertValue,
  type JoinAst,
  type JoinOnExpr,
  type JsonArrayAggExpr,
  type JsonObjectExpr,
  type JsonValueProjectionVisitor,
  type ListExpression,
  LiteralExpr,
  type LoweredParam,
  type NullCheckExpr,
  type OperationExpr,
  type OrderByItem,
  type ProjectionExpr,
  type ProjectionItem,
  type RawExpr,
  type RawQueryAst,
  type SelectAst,
  type SubqueryExpr,
  type TableSource,
  type UpdateAst,
  type WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import type { PostgresCodecDescriptorRegistry } from '@internal/target-postgres/codec-descriptor';
import { isPgEnumParams } from '@internal/target-postgres/codecs';
import {
  escapeLiteral,
  quoteIdentifier,
  quoteQualifiedName,
} from '@internal/target-postgres/sql-utils';
import { ifDefined } from '@internal/utils/defined';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { adapterError } from './adapter-errors';
import type { PostgresContract } from './types';

/**
 * Postgres native types whose unknown-OID parameter inference is reliable in arbitrary expression positions. Parameters bound to a descriptor whose `nativeTypeFor` result falls in this set are emitted as plain `$N`; everything else (including `json`, `jsonb`, extension types like `vector`, and unknown user types) is emitted as `$N::<nativeType>` so the planner picks an unambiguous overload.
 *
 * `json` / `jsonb` are intentionally excluded despite being Postgres builtins: their operator overloads make context inference unreliable in expression positions (e.g. `$1 -> 'key'` is ambiguous between the two).
 *
 * Spellings match the target descriptors' `nativeTypeFor` results, not the `udt_name` abbreviations that ADR 205 used as illustrative shorthand. The registry-based cast policy compares against these strings directly.
 */
const POSTGRES_INFERRABLE_NATIVE_TYPES: ReadonlySet<string> = new Set([
  // Numeric
  'integer',
  'smallint',
  'bigint',
  'real',
  'double precision',
  'numeric',
  // Boolean
  'boolean',
  // Strings
  'text',
  'character',
  'character varying',
  // Temporal
  'timestamp',
  'timestamp without time zone',
  'timestamp with time zone',
  'time',
  'timetz',
  'interval',
  // Bit strings
  'bit',
  'bit varying',
]);

function renderTypedParam(
  index: number,
  codecId: string | undefined,
  codecDescriptorRegistry: PostgresCodecDescriptorRegistry,
  many?: boolean,
  typeParams?: JsonValue,
): string {
  if (codecId === undefined) {
    return `$${index}`;
  }
  const descriptor = codecDescriptorRegistry.descriptorFor(codecId);
  if (descriptor === undefined) {
    throw adapterError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `Postgres lowering: ParamRef carries codecId "${codecId}" but the ` +
        'validated PostgreSQL codec registry has no entry for it. This usually indicates ' +
        'a missing extension pack in the runtime stack — register the pack ' +
        'that contributes this codec (e.g. `extensions: [pgvectorRuntime]`), ' +
        'or use the codec directly from `@internal/target-postgres/codecs` ' +
        "if it's a builtin.",
      { meta: { codecId } },
    );
  }
  const ref: CodecRef = {
    codecId,
    ...ifDefined('many', many),
    ...ifDefined('typeParams', typeParams),
  };
  const nativeType = descriptor.nativeTypeFor(ref);
  const arraySuffix = many ? '[]' : '';
  if (isPgEnumParams(typeParams)) {
    return `$${index}::${quoteQualifiedName(nativeType)}${arraySuffix}`;
  }
  if (!POSTGRES_INFERRABLE_NATIVE_TYPES.has(nativeType) || many) {
    return `$${index}::${nativeType}${arraySuffix}`;
  }
  return `$${index}`;
}

function unreachableKind(value: never): string {
  const candidate: unknown = value;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'kind' in candidate &&
    typeof candidate.kind === 'string'
  ) {
    return candidate.kind;
  }
  return 'unknown';
}

/**
 * Per-render carrier threaded through every helper. Bundles the param-index map (for `$N` numbering) and the assembled-stack target descriptor registry (for cast policy at the `renderTypedParam` chokepoint). Carrying both on a single value keeps helper signatures stable.
 */
interface ParamIndexMap {
  readonly indexMap: Map<AnyParamRef, number>;
  readonly codecDescriptorRegistry: PostgresCodecDescriptorRegistry;
}

/**
 * Render a SQL query AST to a Postgres-flavored `{ sql, params }` payload.
 *
 * Shared between the runtime (`PostgresAdapterImpl.lower`) and control (`PostgresControlAdapter.lower`) entrypoints so emit-time and run-time paths produce byte-identical output for the same AST.
 */
export function renderLoweredSql(
  ast: AnyQueryAst,
  contract: PostgresContract,
  codecDescriptorRegistry: PostgresCodecDescriptorRegistry,
): { readonly sql: string; readonly params: readonly LoweredParam[] } {
  const orderedRefs = collectOrderedParamRefs(ast);
  const indexMap = new Map<AnyParamRef, number>();
  const params: LoweredParam[] = orderedRefs.map((ref, i) => {
    indexMap.set(ref, i + 1);
    return ref.kind === 'prepared-param-ref'
      ? { kind: 'bind', name: ref.name }
      : { kind: 'literal', value: ref.value };
  });
  const pim: ParamIndexMap = { indexMap, codecDescriptorRegistry };

  const node = ast;
  let sql: string;
  switch (node.kind) {
    case 'select':
      sql = renderSelect(node, contract, pim);
      break;
    case 'insert':
      sql = renderInsert(node, contract, pim);
      break;
    case 'update':
      sql = renderUpdate(node, contract, pim);
      break;
    case 'delete':
      sql = renderDelete(node, contract, pim);
      break;
    case 'raw-query':
      sql = renderParts(node.parts, contract, pim);
      break;
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported AST node kind: ${unreachableKind(node)}`);
  }

  return Object.freeze({ sql, params: Object.freeze(params) });
}

function renderLimitOffset(
  keyword: 'LIMIT' | 'OFFSET',
  value: SelectAst['limit'] | SelectAst['offset'],
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return `${keyword} ${value}`;
  return `${keyword} ${renderExpr(value, contract, pim)}`;
}

function renderSelect(ast: SelectAst, contract: PostgresContract, pim: ParamIndexMap): string {
  const selectClause = `SELECT ${renderDistinctPrefix(ast.distinct, ast.distinctOn, ast, contract, pim)}${renderProjection(
    ast.projection,
    contract,
    pim,
  )}`;
  const fromClause = ast.from !== undefined ? `FROM ${renderSource(ast.from, contract, pim)}` : '';

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract, pim)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, contract, pim)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderWhere(ast.having, contract, pim)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderOrderByExpr(order.expr, ast, contract, pim);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';
  const limitClause = renderLimitOffset('LIMIT', ast.limit, contract, pim);
  const offsetClause = renderLimitOffset('OFFSET', ast.offset, contract, pim);

  const clauses = [
    selectClause,
    fromClause,
    joinsClause,
    whereClause,
    groupByClause,
    havingClause,
    orderClause,
    limitClause,
    offsetClause,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
  return clauses.trim();
}

/**
 * The FROM/JOIN source a query-level table reference (alias or bare name)
 * resolves to. The ORDER BY enum hook uses this to look a column-ref's
 * storage column up and read its value-set.
 */
function findFromSource(ast: SelectAst, ref: string): AnyFromSource | undefined {
  const refOf = (source: AnyFromSource): string | undefined =>
    source.kind === 'table-source' ? (source.alias ?? source.name) : source.alias;
  if (ast.from !== undefined && refOf(ast.from) === ref) {
    return ast.from;
  }
  for (const join of ast.joins ?? []) {
    if (refOf(join.source) === ref) {
      return join.source;
    }
  }
  return undefined;
}

/**
 * Whether a FROM/JOIN source carries a column of the given name, and the
 * ordered value-set it resolves to (`undefined` when the column carries no
 * value-set — the common, non-enum case). `found: false` distinguishes "no
 * such column" from "column exists, not enum-backed", which the unqualified
 * identifier resolver needs for its ambiguity check.
 *
 * A `table-source` resolves the column directly against the contract's
 * storage. A `derived-table-source` has no storage column of its own — its
 * columns are projected through a sub-select — so this looks up the
 * matching `ProjectionItem` by output alias and, when the projected
 * expression is itself a plain `ColumnRef`, recurses into the derived
 * table's own query to resolve *that* reference, so nested wraps resolve
 * too. A projected expression that isn't a plain column reference (a
 * function call, a literal, …) has no storage column to trace back to;
 * this reports `found: true` with no value-set, which correctly falls
 * through to plain-column rendering rather than guessing at an order.
 */
function resolveColumnValueSetFromSource(
  source: AnyFromSource,
  column: string,
  contract: PostgresContract,
): { readonly found: boolean; readonly values: readonly JsonValue[] | undefined } {
  if (source.kind === 'table-source') {
    if (source.namespaceId === undefined) {
      return { found: false, values: undefined };
    }
    const ns = contract.storage.namespaces[source.namespaceId];
    const storageColumn = ns?.entries.table?.[source.name]?.columns[column];
    if (storageColumn === undefined) {
      return { found: false, values: undefined };
    }
    const valueSet = storageColumn.valueSet;
    if (valueSet === undefined) {
      return { found: true, values: undefined };
    }
    const valueSetNs = contract.storage.namespaces[valueSet.namespaceId];
    return { found: true, values: valueSetNs?.entries.valueSet?.[valueSet.entityName]?.values };
  }
  if (source.kind === 'derived-table-source') {
    const projected = source.query.projection.find((item) => item.alias === column);
    if (projected === undefined) {
      return { found: false, values: undefined };
    }
    if (projected.expr.kind !== 'column-ref') {
      return { found: true, values: undefined };
    }
    return resolveColumnValueSet(source.query, projected.expr, contract);
  }
  return { found: false, values: undefined };
}

/**
 * Ordered, codec-encoded values of the value-set a storage column restricts
 * to, or `undefined` when the reference doesn't resolve to one (no matching
 * source, no such column, or a column that isn't enum-backed).
 */
function allStrings(values: readonly JsonValue[]): values is readonly string[] {
  return values.every((value) => typeof value === 'string');
}

function resolveColumnValueSet(
  ast: SelectAst,
  ref: ColumnRef,
  contract: PostgresContract,
): { readonly found: boolean; readonly values: readonly JsonValue[] | undefined } {
  const source = findFromSource(ast, ref.table);
  if (source === undefined) {
    return { found: false, values: undefined };
  }
  return resolveColumnValueSetFromSource(source, ref.column, contract);
}

function resolveEnumOrderValues(
  ref: ColumnRef,
  ast: SelectAst,
  contract: PostgresContract,
): readonly JsonValue[] | undefined {
  return resolveColumnValueSet(ast, ref, contract).values;
}

/**
 * Ordered values for an unqualified ORDER BY column (an `identifier-ref`, the shape the sql-builder emits for `.orderBy('col')`). Scans every FROM/JOIN source for a column of that name. Resolves only when exactly one source has a column of that name and it carries a value-set; if more than one source has such a column the bare identifier is ambiguous (regardless of which are enum-backed), so it falls through to the plain column rendering.
 */
function resolveEnumOrderValuesForIdentifier(
  name: string,
  ast: SelectAst,
  contract: PostgresContract,
): readonly JsonValue[] | undefined {
  const candidates = [ast.from, ...(ast.joins ?? []).map((join) => join.source)].filter(
    (source): source is AnyFromSource => source !== undefined,
  );
  let matchedColumns = 0;
  let resolved: readonly JsonValue[] | undefined;
  for (const source of candidates) {
    const { found, values } = resolveColumnValueSetFromSource(source, name, contract);
    if (!found) {
      continue;
    }
    matchedColumns += 1;
    if (matchedColumns > 1) {
      return undefined;
    }
    resolved = values;
  }
  return resolved;
}

/**
 * Render an ORDER BY expression. A column reference onto an enum-restricted column sorts by declaration order via `array_position(ARRAY[…]::text[], <col>)` over the value-set's ordered values (NULLs return `NULL` from `array_position`, sorting per the clause's default NULL handling). Both qualified `column-ref`s and the unqualified `identifier-ref`s the sql-builder emits for `.orderBy('col')` are intercepted. Every other expression renders unchanged.
 */
function renderOrderByExpr(
  expr: AnyExpression,
  ast: SelectAst,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  // Only TEXT enums lower to a value-set whose ORDER BY rewrite ships in this
  // slice. Numeric-enum ORDER BY is future work; until then a non-string
  // value-set falls through to plain column rendering rather than emitting a
  // wrong numeric-as-text ARRAY.
  if (expr.kind === 'column-ref') {
    const orderValues = resolveEnumOrderValues(expr, ast, contract);
    if (orderValues !== undefined && allStrings(orderValues)) {
      const array = orderValues.map((value) => `'${escapeLiteral(value)}'`).join(', ');
      return `array_position(ARRAY[${array}]::text[], ${renderColumn(expr)})`;
    }
  }
  if (expr.kind === 'identifier-ref') {
    const orderValues = resolveEnumOrderValuesForIdentifier(expr.name, ast, contract);
    if (orderValues !== undefined && allStrings(orderValues)) {
      const array = orderValues.map((value) => `'${escapeLiteral(value)}'`).join(', ');
      return `array_position(ARRAY[${array}]::text[], ${quoteIdentifier(expr.name)})`;
    }
  }
  return renderExpr(expr, contract, pim);
}

function renderProjection(
  projection: ReadonlyArray<ProjectionItem>,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, contract, pim)} AS ${alias}`;
    })
    .join(', ');
}

function renderReturning(
  items: ReadonlyArray<ProjectionItem>,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  return items
    .map((item) => {
      if (item.expr.kind === 'column-ref') {
        const rendered = renderColumn(item.expr);
        return item.expr.column === item.alias
          ? rendered
          : `${rendered} AS ${quoteIdentifier(item.alias)}`;
      }
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${quoteIdentifier(item.alias)}`;
      }
      return `${renderExpr(item.expr, contract, pim)} AS ${quoteIdentifier(item.alias)}`;
    })
    .join(', ');
}

function renderDistinctPrefix(
  distinct: true | undefined,
  distinctOn: ReadonlyArray<AnyExpression> | undefined,
  ast: SelectAst,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  if (distinctOn && distinctOn.length > 0) {
    const rendered = distinctOn
      .map((expr) => renderOrderByExpr(expr, ast, contract, pim))
      .join(', ');
    return `DISTINCT ON (${rendered}) `;
  }
  if (distinct) {
    return 'DISTINCT ';
  }
  return '';
}

function hasExplicitSchema(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
): table is Pick<TableSource, 'name' | 'namespaceId'> & { readonly schema: string } {
  return 'schema' in table && typeof table.schema === 'string';
}

function qualifyTableFromNamespaceCoordinate(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
  contract: PostgresContract,
): string {
  if (hasExplicitSchema(table)) {
    return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
  }
  if (table.namespaceId === undefined) {
    return quoteIdentifier(table.name);
  }
  const namespace = contract.storage.namespaces[table.namespaceId];
  if (namespace === undefined) {
    throw adapterError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not present as a Postgres schema on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-present' } },
    );
  }
  const qualifyTable = namespace.qualifyTable;
  if (qualifyTable === undefined) {
    throw adapterError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not materialised as a Postgres schema on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-materialised' } },
    );
  }
  return qualifyTable.call(namespace, table.name);
}

function renderTableSource(source: TableSource, contract: PostgresContract): string {
  const qualified = qualifyTableFromNamespaceCoordinate(source, contract);
  if (!source.alias) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdentifier(source.alias)}`;
}

function renderSource(
  source: AnyFromSource,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return renderTableSource(node, contract);
    case 'derived-table-source':
      return `(${renderSelect(node.query, contract, pim)}) AS ${quoteIdentifier(node.alias)}`;
    case 'function-source': {
      const args = node.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
      const call = `${node.fn}(${args})`;
      const ordinality = node.ordinality ? ' WITH ORDINALITY' : '';
      const alias = node.alias === undefined ? '' : ` AS ${quoteIdentifier(node.alias)}`;
      const columnAliases =
        node.columnAliases === undefined
          ? ''
          : `(${node.columnAliases.map((column) => quoteIdentifier(column)).join(', ')})`;
      return `${call}${ordinality}${alias}${columnAliases}`;
    }
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported source node kind: ${unreachableKind(node)}`);
  }
}

function assertScalarSubquery(query: SelectAst): void {
  if (query.projection.length !== 1) {
    throw adapterError(
      'RUNTIME.AST_INVALID',
      'Subquery expressions must project exactly one column',
      { meta: { node: 'subquery-expr' } },
    );
  }
}

function renderSubqueryExpr(
  expr: SubqueryExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  assertScalarSubquery(expr.query);
  return `(${renderSelect(expr.query, contract, pim)})`;
}

function renderWhere(expr: AnyExpression, contract: PostgresContract, pim: ParamIndexMap): string {
  return renderExpr(expr, contract, pim);
}

function renderNullCheck(
  expr: NullCheckExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const rendered = renderExpr(expr.expr, contract, pim);
  const renderedExpr = isAtomicExpressionKind(expr.expr.kind) ? rendered : `(${rendered})`;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

/**
 * Atomic expression kinds whose rendered SQL is already self-delimited (a column reference, parameter, literal, function call, aggregate, etc.) and therefore does not need surrounding parentheses when used as the left operand of a postfix predicate like `IS NULL` or `IS NOT NULL`, or as either operand of a binary infix operator.
 *
 * Anything not in this set is treated as composite (binary, AND/OR/NOT, EXISTS, nested IS NULL, subqueries, operation templates) and gets wrapped to preserve grouping.
 */
function isAtomicExpressionKind(kind: AnyExpression['kind']): boolean {
  switch (kind) {
    case 'column-ref':
    case 'identifier-ref':
    case 'param-ref':
    case 'prepared-param-ref':
    case 'literal':
    case 'aggregate':
    case 'window-func':
    case 'function-call':
    case 'cast':
    case 'case':
    case 'json-object':
    case 'json-array-agg':
    case 'list':
      return true;
    case 'subquery':
    case 'operation':
    case 'binary':
    case 'and':
    case 'or':
    case 'exists':
    case 'null-check':
    case 'not':
    case 'raw-expr':
      return false;
  }
}

function renderBinary(expr: BinaryExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, contract, pim);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode, contract, pim);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
    case 'prepared-param-ref':
      right = renderParamRef(rightNode, pim);
      break;
    default:
      right = renderExpr(rightNode, contract, pim);
      break;
  }

  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'LIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderListLiteral(
  expr: ListExpression,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref' || v.kind === 'prepared-param-ref') {
        return renderParamRef(v, pim);
      }
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v, contract, pim);
    })
    .join(', ');
  return `(${values})`;
}

function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderAggregateExpr(
  expr: AggregateExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, contract, pim)})`;
}

function renderWindowFuncExpr(
  expr: WindowFuncExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
  const partitionClause =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map((e) => renderExpr(e, contract, pim)).join(', ')}`
      : '';
  const orderClause =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${renderOrderByItems(expr.orderBy, contract, pim)}`
      : '';
  const over = [partitionClause, orderClause].filter((part) => part.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}

function renderFunctionCallExpr(
  expr: FunctionCallExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const args = expr.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
  return `${expr.fn}(${args})`;
}

function renderCastExpr(expr: CastExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  return `CAST(${renderExpr(expr.expr, contract, pim)} AS ${expr.targetType})`;
}

function renderCaseExpr(expr: CaseExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  const branches = expr.branches
    .map(
      (branch) =>
        `WHEN ${renderExpr(branch.condition, contract, pim)} THEN ${renderExpr(branch.value, contract, pim)}`,
    )
    .join(' ');
  const elseClause =
    expr.elseExpr === undefined ? '' : ` ELSE ${renderExpr(expr.elseExpr, contract, pim)}`;
  return `CASE ${branches}${elseClause} END`;
}

function renderJsonValueProjection(
  projection: AnyJsonValueProjection,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const visitor: JsonValueProjectionVisitor<string> = {
    // The codec's descriptor owns the expression that turns a stored value
    // into its canonical JSON — a cast, a function call, or the array lift,
    // chosen on `ref.many` inside `projectJson`.
    codec: ({ value, codec }) =>
      renderExpr(projectJsonThroughCodec(value, codec, pim), contract, pim),
    native: ({ value }) => renderExpr(value, contract, pim),
    // PostgreSQL carries a JSON value's type with it, so a document nested
    // into an enclosing document stays a document without help.
    document: ({ value }) => renderExpr(value, contract, pim),
  };
  return projection.accept(visitor);
}

function projectJsonThroughCodec(
  value: ProjectionExpr,
  codec: CodecRef,
  pim: ParamIndexMap,
): ProjectionExpr {
  const descriptor = pim.codecDescriptorRegistry.descriptorFor(codec.codecId);
  if (descriptor === undefined) {
    throw adapterError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `Postgres lowering: a JSON projection carries codecId "${codec.codecId}" but the ` +
        'validated PostgreSQL codec registry has no entry for it. This usually indicates ' +
        'a missing extension pack in the runtime stack — register the pack ' +
        'that contributes this codec (e.g. `extensions: [pgvectorRuntime]`), ' +
        'or use the codec directly from `@internal/target-postgres/codecs` ' +
        "if it's a builtin.",
      { meta: { codecId: codec.codecId } },
    );
  }
  return descriptor.projectJson(value, codec);
}

function renderJsonObjectExpr(
  expr: JsonObjectExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      return [key, renderJsonValueProjection(entry.value, contract, pim)];
    })
    .join(', ');
  return `json_build_object(${args})`;
}

function renderOrderByItems(
  items: ReadonlyArray<OrderByItem>,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  return items
    .map((item) => `${renderExpr(item.expr, contract, pim)} ${item.dir.toUpperCase()}`)
    .join(', ');
}

function renderJsonArrayAggExpr(
  expr: JsonArrayAggExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, contract, pim)}`
      : '';
  const aggregated = `json_agg(${renderJsonValueProjection(expr.expr, contract, pim)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, json_build_array())`;
  }
  return aggregated;
}

function renderExpr(expr: AnyExpression, contract: PostgresContract, pim: ParamIndexMap): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
    case 'operation':
      return renderOperation(node, contract, pim);
    case 'subquery':
      return renderSubqueryExpr(node, contract, pim);
    case 'aggregate':
      return renderAggregateExpr(node, contract, pim);
    case 'window-func':
      return renderWindowFuncExpr(node, contract, pim);
    case 'function-call':
      return renderFunctionCallExpr(node, contract, pim);
    case 'cast':
      return renderCastExpr(node, contract, pim);
    case 'case':
      return renderCaseExpr(node, contract, pim);
    case 'json-object':
      return renderJsonObjectExpr(node, contract, pim);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, contract, pim);
    case 'binary':
      return renderBinary(node, contract, pim);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract, pim)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract, pim)).join(' OR ')})`;
    case 'exists': {
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, contract, pim);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, contract, pim);
    case 'not':
      return `NOT (${renderExpr(node.expr, contract, pim)})`;
    case 'param-ref':
    case 'prepared-param-ref':
      return renderParamRef(node, pim);
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node, contract, pim);
    case 'raw-expr':
      return renderRawExpr(node, contract, pim);
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported expression node kind: ${unreachableKind(node)}`);
  }
}

function renderParamRef(ref: AnyParamRef, pim: ParamIndexMap): string {
  const index = pim.indexMap.get(ref);
  if (index === undefined) {
    throw new InternalError('ParamRef not found in index map');
  }
  if (ref.kind === 'prepared-param-ref') {
    return renderTypedParam(
      index,
      ref.codec.codecId,
      pim.codecDescriptorRegistry,
      ref.codec.many,
      ref.codec.typeParams,
    );
  }
  if (ref.codec === undefined) {
    throw runtimeError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      'Postgres renderer: ParamRef reached lowering without a bound CodecRef. ' +
        'Every column-bound ParamRef must carry a codec under the AST-bound codec contract. ' +
        'This usually indicates a builder path that constructed a ParamRef without threading the column codec.',
      { paramIndex: index, ...ifDefined('name', ref.name) },
    );
  }
  return renderTypedParam(
    index,
    ref.codec.codecId,
    pim.codecDescriptorRegistry,
    ref.codec.many,
    ref.codec.typeParams,
  );
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${escapeLiteral(expr.value)}'`;
  }
  if (typeof expr.value === 'number' || typeof expr.value === 'boolean') {
    return String(expr.value);
  }
  if (typeof expr.value === 'bigint') {
    return String(expr.value);
  }
  if (expr.value === null) {
    return 'NULL';
  }
  if (expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  if (Array.isArray(expr.value)) {
    return `ARRAY[${expr.value.map((v: unknown) => renderLiteral(new LiteralExpr(v))).join(', ')}]`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(
  expr: OperationExpr,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  const self = renderExpr(expr.self, contract, pim);
  const args = expr.args.map((arg) => {
    return renderExpr(arg, contract, pim);
  });

  // Resolve `{{self}}` and `{{argN}}` from the original template in a single pass. Doing this with sequential `String.prototype.replace` calls is unsafe: a substituted fragment can itself contain text that matches a later token (e.g. an arg literal containing the substring `{{arg1}}`), and the next iteration would corrupt it. A single regex callback never re-scans already-substituted output.
  return expr.lowering.template.replace(
    /\{\{self\}\}|\{\{arg(\d+)\}\}/g,
    (token, argIndex: string | undefined) => {
      if (token === '{{self}}') {
        return self;
      }
      const arg = args[Number(argIndex)];
      if (arg === undefined) {
        throw adapterError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Operation lowering template for "${expr.method}" referenced missing argument {{arg${argIndex}}}; template has ${args.length} arg(s)`,
          { meta: { method: expr.method } },
        );
      }
      return arg;
    },
  );
}

function renderJoin(join: JoinAst, contract: PostgresContract, pim: ParamIndexMap): string {
  const joinType = join.joinType.toUpperCase();
  const lateral = join.lateral ? 'LATERAL ' : '';
  const source = renderSource(join.source, contract, pim);
  const onClause = renderJoinOn(join.on, contract, pim);
  return `${joinType} JOIN ${lateral}${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  if (on.kind === 'eq-col-join-on') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, contract, pim);
}

function getInsertColumnOrder(
  rows: ReadonlyArray<Record<string, InsertValue>>,
  contract: PostgresContract,
  tableRef: Pick<TableSource, 'name' | 'namespaceId'>,
): string[] {
  const tableName = tableRef.name;
  const orderedColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      orderedColumns.push(column);
    }
  }

  if (orderedColumns.length > 0) {
    return orderedColumns;
  }

  let table: { columns: Readonly<Record<string, unknown>> } | undefined;
  if (tableRef.namespaceId !== undefined) {
    const ns = contract.storage.namespaces[tableRef.namespaceId];
    table = ns !== undefined ? ns.entries.table?.[tableName] : undefined;
  }
  if (table === undefined) {
    for (const ns of Object.values(contract.storage.namespaces)) {
      const found = ns.entries.table?.[tableName];
      if (found !== undefined) {
        table = found;
        break;
      }
    }
  }
  if (!table) {
    throw adapterError(
      'RUNTIME.AST_INVALID',
      `INSERT target table not found in contract storage: ${tableName}`,
      { meta: { node: 'insert', table: tableName } },
    );
  }
  return Object.keys(table.columns);
}

function renderInsertValue(
  value: InsertValue | undefined,
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  if (!value || value.kind === 'default-value') {
    return 'DEFAULT';
  }

  switch (value.kind) {
    case 'param-ref':
    case 'prepared-param-ref':
      return renderParamRef(value, pim);
    case 'column-ref':
      return renderColumn(value);
    case 'raw-expr':
      return renderExpr(value, contract, pim);
    // v8 ignore next 4
    default:
      assertNever(value, `Unsupported value node in INSERT: ${unreachableKind(value)}`);
  }
}

function renderInsert(ast: InsertAst, contract: PostgresContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const rows = ast.rows;
  if (rows.length === 0) {
    throw adapterError('RUNTIME.AST_INVALID', 'INSERT requires at least one row', {
      meta: { node: 'insert' },
    });
  }
  const hasExplicitValues = rows.some((row) => Object.keys(row).length > 0);
  const insertClause = (() => {
    if (!hasExplicitValues) {
      if (rows.length === 1) {
        return `INSERT INTO ${table} DEFAULT VALUES`;
      }

      const defaultColumns = getInsertColumnOrder(rows, contract, ast.table);
      if (defaultColumns.length === 0) {
        return `INSERT INTO ${table} VALUES ${rows.map(() => '()').join(', ')}`;
      }

      const quotedColumns = defaultColumns.map((column) => quoteIdentifier(column));
      const defaultRow = `(${defaultColumns.map(() => 'DEFAULT').join(', ')})`;
      return `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rows
        .map(() => defaultRow)
        .join(', ')}`;
    }

    const columnOrder = getInsertColumnOrder(rows, contract, ast.table);
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) =>
          renderInsertValue(row[column], contract, pim),
        );
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');

    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  })();
  const onConflictClause = ast.onConflict
    ? (() => {
        const conflictColumns = ast.onConflict.columns.map((col) => quoteIdentifier(col.column));
        if (conflictColumns.length === 0) {
          throw adapterError(
            'RUNTIME.AST_INVALID',
            'INSERT onConflict requires at least one conflict column',
            { meta: { node: 'insert-on-conflict' } },
          );
        }

        const action = ast.onConflict.action;
        switch (action.kind) {
          case 'do-nothing':
            return ` ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
          case 'do-update-set': {
            const updateEntries = Object.entries(action.set);
            if (updateEntries.length === 0) {
              throw adapterError(
                'RUNTIME.AST_INVALID',
                'INSERT onConflict do-update-set requires at least one assignment',
                { meta: { node: 'insert-on-conflict' } },
              );
            }
            const updates = updateEntries.map(([colName, value]) => {
              return `${quoteIdentifier(colName)} = ${renderExpr(value, contract, pim)}`;
            });
            return ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
          }
          // v8 ignore next 4
          default:
            assertNever(action, `Unsupported onConflict action: ${unreachableKind(action)}`);
        }
      })()
    : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: PostgresContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const setEntries = Object.entries(ast.set);
  if (setEntries.length === 0) {
    throw adapterError('RUNTIME.AST_INVALID', 'UPDATE requires at least one SET assignment', {
      meta: { node: 'update' },
    });
  }
  const setClauses = setEntries.map(([col, val]) => {
    const column = quoteIdentifier(col);
    return `${column} = ${renderExpr(val, contract, pim)}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract: PostgresContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

function renderParts(
  parts: RawExpr['parts'] | RawQueryAst['parts'],
  contract: PostgresContract,
  pim: ParamIndexMap,
): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : renderExpr(part, contract, pim)))
    .join('');
}

function renderRawExpr(node: RawExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  return renderParts(node.parts, contract, pim);
}
