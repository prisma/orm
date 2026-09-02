import type { CodecRef } from '@internal/framework-components/codec';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type {
  Adapter,
  AdapterProfile,
  AggregateExpr,
  AnyExpression,
  AnyFromSource,
  AnyJsonValueProjection,
  AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  DeleteAst,
  FunctionCallExpr,
  InsertAst,
  InsertValue,
  JoinAst,
  JoinOnExpr,
  JsonArrayAggExpr,
  JsonObjectExpr,
  JsonValueProjectionVisitor,
  ListExpression,
  LiteralExpr,
  LoweredParam,
  LowererContext,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ProjectionExpr,
  ProjectionItem,
  RawExpr,
  RawQueryAst,
  RawSqlLiteral,
  SelectAst,
  SqlQueryable,
  SubqueryExpr,
  TableSource,
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { isDdlNode } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { SqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codec-descriptor';
import { jsonDocumentRetag } from '@internal/target-sqlite/codecs';
import type { SqliteDdlNode } from '@internal/target-sqlite/ddl';
import { escapeLiteral, quoteIdentifier } from '@internal/target-sqlite/sql-utils';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { createSqliteCodecRegistryWithBuiltins } from './codec-lookup';
import { SqliteControlAdapter } from './control-adapter';
import type {
  SqliteAdapterOptions,
  SqliteCodecRegistry,
  SqliteContract,
  SqliteLoweredStatement,
} from './types';

function nodeKind(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string'
  ) {
    return value.kind;
  }
  return 'unknown';
}

function unreachableKind(value: never): string {
  return nodeKind(value);
}

const defaultCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    lateral: false,
    jsonAgg: true,
    returning: true,
    enums: false,
  },
});

class SqliteAdapterImpl implements Adapter<AnyQueryAst, SqliteContract, SqliteLoweredStatement> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  readonly profile: AdapterProfile<'sqlite'>;

  readonly #codecs: SqliteCodecRegistry;

  constructor(codecRegistry: SqliteCodecRegistry, profileId?: string) {
    this.#codecs = codecRegistry;
    const controlAdapter = new SqliteControlAdapter(codecRegistry);
    this.profile = Object.freeze({
      id: profileId ?? 'sqlite/default@1',
      target: 'sqlite',
      capabilities: defaultCapabilities,
      readMarker: (queryable: SqlQueryable) =>
        controlAdapter.readMarkerDiscriminated(
          {
            familyId: 'sql',
            targetId: 'sqlite',
            query: async <Row = Record<string, unknown>>(
              sql: string,
              params?: readonly unknown[],
            ) => {
              const rows: Row[] = [];
              for await (const row of queryable.query<Row>({
                sql,
                ...(params === undefined ? {} : { params }),
              })) {
                rows.push(row);
              }
              return { rows };
            },
            close: async () => {},
          },
          APP_SPACE_ID,
        ),
    });
  }

  lower(
    ast: AnyQueryAst | SqliteDdlNode,
    context: LowererContext<SqliteContract>,
  ): SqliteLoweredStatement {
    if (isDdlNode(ast)) {
      throw structuredError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() does not lower DDL on the runtime adapter — DDL lowering is a control-plane concern handled by the control adapter.',
        { meta: { surface: 'runtime-adapter' } },
      );
    }
    return renderLoweredSql(ast, context.contract, this.#codecs);
  }
}

/** Codec-id lookup for bare-literal interpolations used by `fns.raw` on a sqlite client. Contributed as the descriptor's static `rawCodecInferer` slot. */
export const sqliteRawCodecInferer: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    switch (typeof value) {
      case 'number':
        return Number.isSafeInteger(value) && value % 1 === 0
          ? 'sqlite/integer@1'
          : 'sqlite/real@1';
      case 'bigint':
        return 'sqlite/bigint@1';
      case 'string':
        return 'sqlite/text@1';
      case 'boolean':
        return 'sqlite/integer@1';
      case 'object':
        if (value instanceof Uint8Array) return 'sqlite/blob@1';
    }
    throw structuredError(
      'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
      'unsupported JS value type for raw-SQL interpolation: wrap this value in `param(...)` with an explicit codec',
      { meta: { valueType: typeof value } },
    );
  },
};

/**
 * What every render function needs: the contract it renders against, and the
 * validated codec registry a JSON projection resolves its descriptor from. The
 * two travel together so no render path can reach a codec entry without the
 * registry that explains it.
 */
interface SqliteRenderContext {
  readonly contract: SqliteContract | undefined;
  readonly codecs: SqliteCodecDescriptorRegistry;
}

/**
 * Lower a SQL query AST into a SQLite-flavored `{ sql, params }` payload.
 *
 * Shared between the runtime adapter (`SqliteAdapterImpl.lower`) and the control adapter (`SqliteControlAdapter.lower`) so both produce byte-identical SQL for the same AST and contract.
 */
export function renderLoweredSql(
  ast: AnyQueryAst,
  contract: SqliteContract,
  codecs: SqliteCodecDescriptorRegistry,
): SqliteLoweredStatement {
  const ctx: SqliteRenderContext = { contract, codecs };
  const collectedParamRefs = ast.collectParamRefs();
  const params: LoweredParam[] = [];
  for (const ref of collectedParamRefs) {
    params.push(
      ref.kind === 'prepared-param-ref'
        ? { kind: 'bind', name: ref.name }
        : { kind: 'literal', value: ref.value },
    );
  }

  let sql: string;

  const node = ast;
  switch (node.kind) {
    case 'select':
      sql = renderSelect(node, ctx);
      break;
    case 'insert':
      sql = renderInsert(node, ctx);
      break;
    case 'update':
      sql = renderUpdate(node, ctx);
      break;
    case 'delete':
      sql = renderDelete(node, ctx);
      break;
    case 'raw-query':
      sql = renderParts(node.parts, ctx);
      break;
    default:
      throw new InternalError(`Unsupported AST node kind: ${nodeKind(node)}`);
  }

  return Object.freeze({ sql, params });
}

function renderLimitOffset(
  keyword: 'LIMIT' | 'OFFSET',
  value: SelectAst['limit'] | SelectAst['offset'],
  ctx: SqliteRenderContext,
): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return `${keyword} ${value}`;
  return `${keyword} ${renderExpr(value, ctx)}`;
}

function renderSelect(ast: SelectAst, ctx: SqliteRenderContext): string {
  const distinctPrefix = ast.distinct ? 'DISTINCT ' : '';
  const selectClause = `SELECT ${distinctPrefix}${renderProjection(ast.projection, ctx)}`;
  const fromClause = ast.from !== undefined ? `FROM ${renderSource(ast.from, ctx)}` : '';

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, ctx)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderExpr(ast.where, ctx)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, ctx)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderExpr(ast.having, ctx)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map(
          (order) =>
            `${renderExpr(order.expr, ctx)} ${order.dir.toUpperCase()}${renderNullsPlacement(order)}`,
        )
        .join(', ')}`
    : '';
  // SQLite has no standalone OFFSET clause, so an offset with no limit needs an explicit LIMIT -1.
  const limitClause =
    ast.limit === undefined && ast.offset !== undefined
      ? 'LIMIT -1'
      : renderLimitOffset('LIMIT', ast.limit, ctx);
  const offsetClause = renderLimitOffset('OFFSET', ast.offset, ctx);

  return [
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
    .join(' ')
    .trim();
}

function renderProjection(
  projection: ReadonlyArray<ProjectionItem>,
  ctx: SqliteRenderContext,
): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, ctx)} AS ${alias}`;
    })
    .join(', ');
}

function qualifyTableFromNamespaceCoordinate(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
  ctx: SqliteRenderContext,
): string {
  if (table.namespaceId === undefined) {
    return quoteIdentifier(table.name);
  }
  // Qualifying a namespaced table reads the namespace off the contract, so a
  // caller that reached here without one asked for something it cannot have.
  if (ctx.contract === undefined) {
    throw new InternalError(
      `Table "${table.name}" carries namespace "${table.namespaceId}" but no contract was supplied to resolve it`,
    );
  }
  const namespace = ctx.contract.storage.namespaces[table.namespaceId];
  if (namespace === undefined) {
    throw structuredError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not present on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-present' } },
    );
  }
  const qualifyTable = namespace.qualifyTable;
  if (qualifyTable === undefined) {
    throw structuredError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not materialised for SQL rendering on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-materialised' } },
    );
  }
  return qualifyTable.call(namespace, table.name);
}

function renderTableSource(source: TableSource, ctx: SqliteRenderContext): string {
  const qualified = qualifyTableFromNamespaceCoordinate(source, ctx);
  if (!source.alias) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdentifier(source.alias)}`;
}

function renderSource(source: AnyFromSource, ctx: SqliteRenderContext): string {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return renderTableSource(node, ctx);
    case 'derived-table-source':
      return `(${renderSelect(node.query, ctx)}) AS ${quoteIdentifier(node.alias)}`;
    case 'function-source': {
      if (node.ordinality) {
        throw structuredError(
          'RUNTIME.AST_UNSUPPORTED',
          'SQLite does not support WITH ORDINALITY on function sources',
          { meta: { target: 'sqlite', feature: 'function-source-with-ordinality' } },
        );
      }
      if (node.columnAliases !== undefined) {
        throw structuredError(
          'RUNTIME.AST_UNSUPPORTED',
          'SQLite does not support returned-column aliases on function sources',
          { meta: { target: 'sqlite', feature: 'function-source-column-aliases' } },
        );
      }
      const args = node.args.map((arg) => renderExpr(arg, ctx)).join(', ');
      const call = `${node.fn}(${args})`;
      return node.alias !== undefined ? `${call} AS ${quoteIdentifier(node.alias)}` : call;
    }
    default:
      return assertNever(node, `Unsupported source node kind: ${unreachableKind(node)}`);
  }
}

function renderExpr(expr: AnyExpression, ctx: SqliteRenderContext): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
    case 'operation':
      return renderOperation(node, ctx);
    case 'subquery':
      return renderSubqueryExpr(node, ctx);
    case 'aggregate':
      return renderAggregateExpr(node, ctx);
    case 'window-func':
      return renderWindowFuncExpr(node, ctx);
    case 'function-call':
      return renderFunctionCallExpr(node, ctx);
    case 'cast':
      return renderCastExpr(node, ctx);
    case 'case':
      return renderCaseExpr(node, ctx);
    case 'json-object':
      return renderJsonObjectExpr(node, ctx);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, ctx);
    case 'binary':
      return renderBinary(node, ctx);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' OR ')})`;
    case 'exists': {
      if (ctx.contract === undefined) {
        throw new InternalError('EXISTS subquery rendering requires a Sqlite contract');
      }
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, ctx);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, ctx);
    case 'not':
      return `NOT (${renderExpr(node.expr, ctx)})`;
    case 'param-ref':
    case 'prepared-param-ref':
      return '?';
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node, ctx);
    case 'raw-expr':
      return renderRawExpr(node, ctx);
    default:
      return assertNever(node, `Unsupported expression node kind: ${unreachableKind(node)}`);
  }
}

function renderParts(
  parts: RawExpr['parts'] | RawQueryAst['parts'],
  ctx: SqliteRenderContext,
): string {
  return parts.map((part) => (typeof part === 'string' ? part : renderExpr(part, ctx))).join('');
}

function renderRawExpr(node: RawExpr, ctx: SqliteRenderContext): string {
  return renderParts(node.parts, ctx);
}

// `excluded` is a pseudo-table in ON CONFLICT DO UPDATE that references the row proposed for insertion. It is not quoted because it's a keyword.
function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
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
  if (expr.value === null || expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(expr: OperationExpr, ctx: SqliteRenderContext): string {
  const self = renderExpr(expr.self, ctx);
  const args = expr.args.map((arg) => renderExpr(arg, ctx));

  let result = expr.lowering.template;
  result = result.replace(/\{\{self\}\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\{\\{arg${i}\\}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderSubqueryExpr(expr: SubqueryExpr, ctx: SqliteRenderContext): string {
  if (expr.query.projection.length !== 1) {
    throw structuredError(
      'RUNTIME.AST_INVALID',
      'Subquery expressions must project exactly one column',
      { meta: { node: 'subquery' } },
    );
  }
  if (ctx.contract === undefined) {
    throw new InternalError('Subquery expression rendering requires a Sqlite contract');
  }
  return `(${renderSelect(expr.query, ctx)})`;
}

function requiresNullCheckGrouping(kind: AnyExpression['kind']): boolean {
  switch (kind) {
    case 'operation':
    case 'subquery':
      return true;
    case 'column-ref':
    case 'identifier-ref':
    case 'aggregate':
    case 'window-func':
    case 'function-call':
    case 'cast':
    case 'case':
    case 'json-object':
    case 'json-array-agg':
    case 'binary':
    case 'and':
    case 'or':
    case 'exists':
    case 'null-check':
    case 'not':
    case 'param-ref':
    case 'prepared-param-ref':
    case 'literal':
    case 'list':
    case 'raw-expr':
      return false;
  }
}

function renderNullCheck(expr: NullCheckExpr, ctx: SqliteRenderContext): string {
  const rendered = renderExpr(expr.expr, ctx);
  const renderedExpr = requiresNullCheckGrouping(expr.expr.kind) ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, ctx: SqliteRenderContext): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, ctx);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode, ctx);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
    case 'prepared-param-ref':
      right = '?';
      break;
    default:
      right = renderExpr(rightNode, ctx);
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

function renderListLiteral(expr: ListExpression, ctx: SqliteRenderContext): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref' || v.kind === 'prepared-param-ref') return '?';
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v, ctx);
    })
    .join(', ');
  return `(${values})`;
}

function renderAggregateExpr(expr: AggregateExpr, ctx: SqliteRenderContext): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, ctx)})`;
}

function renderWindowFuncExpr(expr: WindowFuncExpr, ctx: SqliteRenderContext): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map((arg) => renderExpr(arg, ctx)).join(', ');
  const partitionClause =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map((e) => renderExpr(e, ctx)).join(', ')}`
      : '';
  const orderClause =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}`
      : '';
  const over = [partitionClause, orderClause].filter((part) => part.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}

function renderFunctionCallExpr(expr: FunctionCallExpr, ctx: SqliteRenderContext): string {
  const args = expr.args.map((arg) => renderExpr(arg, ctx)).join(', ');
  return `${expr.fn}(${args})`;
}

function renderCastExpr(expr: CastExpr, ctx: SqliteRenderContext): string {
  return `CAST(${renderExpr(expr.expr, ctx)} AS ${expr.targetType})`;
}

function renderCaseExpr(expr: CaseExpr, ctx: SqliteRenderContext): string {
  const branches = expr.branches
    .map(
      (branch) => `WHEN ${renderExpr(branch.condition, ctx)} THEN ${renderExpr(branch.value, ctx)}`,
    )
    .join(' ');
  const elseClause = expr.elseExpr === undefined ? '' : ` ELSE ${renderExpr(expr.elseExpr, ctx)}`;
  return `CASE ${branches}${elseClause} END`;
}

function renderJsonValueProjection(
  projection: AnyJsonValueProjection,
  ctx: SqliteRenderContext,
): string {
  const visitor: JsonValueProjectionVisitor<string> = {
    // The codec's descriptor owns the expression that turns a stored value into
    // its canonical JSON: decimal text for a bigint, uppercase hex for a blob.
    codec: ({ value, codec }) => renderExpr(projectJsonThroughCodec(value, codec, ctx.codecs), ctx),
    native: ({ value }) => renderExpr(value, ctx),
    // SQLite carries "this text is JSON" as a subtype on the value, and the
    // subtype does not survive a derived table. A document arriving from one is
    // plain text by the time the enclosing constructor sees it, so it is
    // retagged here — at the boundary that consumes it, which is the only level
    // that needs it, the retag collapsing when it is already applied.
    document: ({ value }) => renderExpr(jsonDocumentRetag(value), ctx),
  };
  return projection.accept(visitor);
}

function projectJsonThroughCodec(
  value: ProjectionExpr,
  codec: CodecRef,
  codecs: SqliteCodecDescriptorRegistry,
): ProjectionExpr {
  const descriptor = codecs.descriptorFor(codec.codecId);
  if (descriptor === undefined) {
    throw structuredError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `SQLite lowering: a JSON projection carries codecId "${codec.codecId}" but the ` +
        'validated SQLite codec registry has no entry for it. This usually indicates a ' +
        'missing extension pack in the runtime stack — register the pack that ' +
        'contributes this codec, or use the codec directly from ' +
        "`@prisma/orm-target-sqlite/target/codecs` if it's a builtin.",
      { meta: { codecId: codec.codecId } },
    );
  }
  return descriptor.projectJson(value, codec);
}

function renderJsonObjectExpr(expr: JsonObjectExpr, ctx: SqliteRenderContext): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      return [key, renderJsonValueProjection(entry.value, ctx)];
    })
    .join(', ');
  return `json_object(${args})`;
}

/** The `NULLS FIRST` / `NULLS LAST` suffix for an ORDER BY item, or empty when the item leaves NULL placement to SQLite's default for the sort direction. */
function renderNullsPlacement(item: OrderByItem): string {
  return item.nulls === undefined ? '' : ` NULLS ${item.nulls.toUpperCase()}`;
}

function renderOrderByItems(items: ReadonlyArray<OrderByItem>, ctx: SqliteRenderContext): string {
  return items
    .map(
      (item) =>
        `${renderExpr(item.expr, ctx)} ${item.dir.toUpperCase()}${renderNullsPlacement(item)}`,
    )
    .join(', ');
}

function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, ctx: SqliteRenderContext): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}`
      : '';
  const aggregated = `json_group_array(${renderJsonValueProjection(expr.expr, ctx)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, '[]')`;
  }
  return aggregated;
}

function renderJoin(join: JoinAst, ctx: SqliteRenderContext): string {
  if (ctx.contract === undefined) {
    throw new InternalError('JOIN rendering requires a Sqlite contract');
  }
  const joinType = join.joinType.toUpperCase();
  const source = renderSource(join.source, ctx);
  const onClause = renderJoinOn(join.on, ctx);
  return `${joinType} JOIN ${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, ctx: SqliteRenderContext): string {
  if (on.kind === 'eq-col-join-on') {
    return `${renderColumn(on.left)} = ${renderColumn(on.right)}`;
  }
  return renderExpr(on, ctx);
}

function renderInsertValue(value: InsertValue, ctx: SqliteRenderContext): string {
  switch (value.kind) {
    case 'param-ref':
    case 'prepared-param-ref':
      return '?';
    case 'column-ref':
      return renderColumn(value);
    case 'raw-expr':
      return renderExpr(value, ctx);
    case 'default-value':
      throw structuredError(
        'RUNTIME.AST_UNSUPPORTED',
        'SQLite does not support DEFAULT as a value in INSERT ... VALUES',
        { meta: { node: 'default-value' } },
      );
    default:
      return assertNever(value, `Unsupported value node in INSERT: ${unreachableKind(value)}`);
  }
}

function renderInsert(ast: InsertAst, ctx: SqliteRenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const rows = ast.rows;
  const firstRow = rows[0];
  if (firstRow === undefined) {
    throw structuredError('RUNTIME.AST_INVALID', 'INSERT requires at least one row', {
      meta: { node: 'insert', table: ast.table.name },
    });
  }

  const columnOrder = Object.keys(firstRow);

  let insertClause: string;
  if (columnOrder.length === 0) {
    insertClause = `INSERT INTO ${table} DEFAULT VALUES`;
  } else {
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) => {
          const value = row[column];
          if (value === undefined) {
            throw structuredError(
              'RUNTIME.AST_INVALID',
              `Missing value for column "${column}" in INSERT row`,
              { meta: { node: 'insert', table: ast.table.name, column } },
            );
          }
          return renderInsertValue(value, ctx);
        });
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');
    insertClause = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  }

  let onConflictClause = '';
  if (ast.onConflict) {
    const conflictColumns = ast.onConflict.columns.map((col) => quoteIdentifier(col.column));
    if (conflictColumns.length === 0) {
      throw structuredError(
        'RUNTIME.AST_INVALID',
        'INSERT onConflict requires at least one conflict column',
        { meta: { node: 'insert', table: ast.table.name } },
      );
    }

    const action = ast.onConflict.action;
    switch (action.kind) {
      case 'do-nothing':
        onConflictClause = ` ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
        break;
      case 'do-update-set': {
        const updates = Object.entries(action.set).map(([colName, value]) => {
          return `${quoteIdentifier(colName)} = ${renderExpr(value, ctx)}`;
        });
        onConflictClause = ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
        break;
      }
      default:
        assertNever(action, `Unsupported onConflict action: ${unreachableKind(action)}`);
    }
  }

  const returningClause = renderReturning(ast.returning, ctx);

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, ctx: SqliteRenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    return `${quoteIdentifier(col)} = ${renderExpr(val, ctx)}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where, ctx)}` : '';
  const returningClause = renderReturning(ast.returning, ctx);

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, ctx: SqliteRenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where, ctx)}` : '';
  const returningClause = renderReturning(ast.returning, ctx);

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

function renderReturning(
  returning: ReadonlyArray<ProjectionItem> | undefined,
  ctx: SqliteRenderContext,
): string {
  if (!returning?.length) {
    return '';
  }
  return ` RETURNING ${returning
    .map((item) => {
      if (item.expr.kind === 'column-ref') {
        const rendered = `${quoteIdentifier(item.expr.table)}.${quoteIdentifier(item.expr.column)}`;
        return item.expr.column === item.alias
          ? rendered
          : `${rendered} AS ${quoteIdentifier(item.alias)}`;
      }
      return `${renderExpr(item.expr, ctx)} AS ${quoteIdentifier(item.alias)}`;
    })
    .join(', ')}`;
}

export function createSqliteAdapter(options?: SqliteAdapterOptions) {
  const codecRegistry = createSqliteCodecRegistryWithBuiltins(options?.codecDescriptors);
  return Object.freeze(new SqliteAdapterImpl(codecRegistry, options?.profileId));
}

export function createSqliteAdapterWithCodecRegistry(codecRegistry: SqliteCodecRegistry) {
  return Object.freeze(new SqliteAdapterImpl(codecRegistry));
}
