import type { Contract } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  AggregateExpr,
  AnyExpression,
  AnyFromSource,
  AnyJsonValueProjection,
  AnyParamRef,
  AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  FunctionCallExpr,
  JoinAst,
  JoinOnExpr,
  JsonArrayAggExpr,
  JsonObjectExpr,
  JsonValueProjectionVisitor,
  ListExpression,
  LiteralExpr,
  LoweredParam,
  LoweredStatement,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ProjectionExpr,
  ProjectionItem,
  RawExpr,
  RawQueryAst,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import type { MysqlCodecDescriptorRegistry } from '@internal/target-mysql/codec-descriptor';
import { mysqlBigint, mysqlInt } from '@internal/target-mysql/data-types';
import { mysqlError, mysqlQueryNotYetSupported } from '@internal/target-mysql/errors';
import {
  escapeLiteral,
  type MysqlPlaceholderToken,
  type MysqlSqlToken,
  quoteIdentifier,
  tokenizeMysqlSql,
} from '@internal/target-mysql/sql-utils';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { assertPlaceholdersMatchParams } from './placeholders';

export type MysqlContract = Contract<SqlStorage>;

interface RenderContext {
  readonly contract: MysqlContract | undefined;
  readonly codecs: MysqlCodecDescriptorRegistry;
  /** Each param's placeholder number: its position in `collectOrderedParamRefs`, the order the runtime encodes params in. */
  readonly placeholderNumbers: ReadonlyMap<AnyParamRef, number>;
  /** Set when the statement builds an array with `GROUP_CONCAT`, whose length limit the statement then raises itself. */
  readonly uses: { groupConcat: boolean };
}

/**
 * Raises `group_concat_max_len` for this statement only, past any result a connection can send, so an ordered include does not depend on how the driver set up its session. MySQL takes `SET_VAR` only on the outermost `SELECT`.
 */
const GROUP_CONCAT_HINT = '/*+ SET_VAR(group_concat_max_len = 4294967295) */';

/** MySQL's documented way to write an `OFFSET` with no `LIMIT`: the largest row count it takes. */
const NO_LIMIT = '18446744073709551615';

function nodeKind(value: unknown): string {
  return typeof value === 'object' && value !== null && 'kind' in value
    ? String(value.kind)
    : 'unknown';
}

function unsupported(feature: string, message: string): Error {
  return mysqlError('RUNTIME.AST_UNSUPPORTED', message, { meta: { target: 'mysql', feature } });
}

/**
 * Lowers a query AST to MySQL SQL. Each param is written as `?N`, N being its position in `collectOrderedParamRefs`, the order the runtime encodes and middleware edits params in; a param written twice is bound once. The driver fills the placeholders.
 */
export function renderMysqlSql(
  ast: AnyQueryAst,
  contract: MysqlContract | undefined,
  codecs: MysqlCodecDescriptorRegistry,
): LoweredStatement {
  const placeholderNumbers = new Map<AnyParamRef, number>();
  const params: LoweredParam[] = collectOrderedParamRefs(ast).map((ref, index) => {
    placeholderNumbers.set(ref, index + 1);
    return ref.kind === 'prepared-param-ref'
      ? { kind: 'bind', name: ref.name }
      : { kind: 'literal', value: ref.value };
  });
  const ctx: RenderContext = {
    contract,
    codecs,
    placeholderNumbers,
    uses: { groupConcat: false },
  };
  const rendered = renderStatement(ast, ctx);
  const sql = ctx.uses.groupConcat ? withGroupConcatHint(ast, rendered) : rendered;
  assertPlaceholdersMatchParams(sql, params.length);
  return Object.freeze({ sql, params });
}

/** Puts `GROUP_CONCAT_HINT` on the outermost `SELECT`; a statement without one would leave `GROUP_CONCAT` at the session's limit, which can cut an array after an element and still read as JSON, so it is refused. */
function withGroupConcatHint(ast: AnyQueryAst, rendered: string): string {
  if (ast.kind !== 'select' || !rendered.startsWith('SELECT ')) {
    throw unsupported(
      'ordered-array-outside-select',
      'MySQL can build an ordered JSON array only in a SELECT statement, whose outermost SELECT carries the hint that raises group_concat_max_len',
    );
  }
  return `SELECT ${GROUP_CONCAT_HINT} ${rendered.slice('SELECT '.length)}`;
}

function renderStatement(ast: AnyQueryAst, ctx: RenderContext): string {
  switch (ast.kind) {
    case 'select':
      return renderSelect(ast, ctx);
    case 'raw-query':
      return renderParts(ast.parts, ctx);
    case 'insert':
    case 'update':
    case 'delete':
      throw mysqlQueryNotYetSupported('Writing rows');
    default:
      throw new InternalError(`Unsupported AST node kind: ${nodeKind(ast)}`);
  }
}

function renderLimitOffset(
  keyword: 'LIMIT' | 'OFFSET',
  value: SelectAst['limit'],
  ctx: RenderContext,
): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return `${keyword} ${value}`;
  const rendered =
    value.kind === 'param-ref' || value.kind === 'prepared-param-ref'
      ? placeholder(value, ctx)
      : renderExpr(value, ctx);
  return `${keyword} ${rendered}`;
}

function renderSelect(ast: SelectAst, ctx: RenderContext): string {
  if (ast.locking !== undefined && ast.locking.length > 0) {
    throw unsupported(
      'locking-clause',
      'Row locks are not supported on MySQL yet, so a select cannot carry a locking clause such as FOR UPDATE',
    );
  }
  if (ast.distinctOn !== undefined && ast.distinctOn.length > 0) {
    throw unsupported('distinct-on', 'MySQL has no DISTINCT ON');
  }
  return [
    `SELECT ${ast.distinct ? 'DISTINCT ' : ''}${renderProjection(ast.projection, ctx)}`,
    ast.from === undefined ? '' : `FROM ${renderSource(ast.from, ctx)}`,
    ast.joins?.length ? ast.joins.map((join) => renderJoin(join, ctx)).join(' ') : '',
    ast.where ? `WHERE ${renderExpr(ast.where, ctx)}` : '',
    ast.groupBy?.length ? `GROUP BY ${ast.groupBy.map((e) => renderExpr(e, ctx)).join(', ')}` : '',
    ast.having ? `HAVING ${renderExpr(ast.having, ctx)}` : '',
    ast.orderBy?.length ? `ORDER BY ${renderOrderByItems(ast.orderBy, ctx)}` : '',
    ast.limit === undefined && ast.offset !== undefined
      ? `LIMIT ${NO_LIMIT}`
      : renderLimitOffset('LIMIT', ast.limit, ctx),
    renderLimitOffset('OFFSET', ast.offset, ctx),
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

function renderProjection(projection: ReadonlyArray<ProjectionItem>, ctx: RenderContext): string {
  return projection
    .map((item) => `${renderExpr(item.expr, ctx)} AS ${quoteIdentifier(item.alias)}`)
    .join(', ');
}

function qualifyTable(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
  ctx: RenderContext,
): string {
  if (table.namespaceId === undefined) return quoteIdentifier(table.name);
  if (ctx.contract === undefined) {
    throw new InternalError(
      `Table "${table.name}" carries namespace "${table.namespaceId}" but no contract was supplied to resolve it`,
    );
  }
  const namespace = ctx.contract.storage.namespaces[table.namespaceId];
  if (namespace?.qualifyTable === undefined) {
    throw structuredError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which the contract does not materialise for SQL rendering`,
      {
        meta: {
          table: table.name,
          namespaceId: table.namespaceId,
          reason: namespace === undefined ? 'not-present' : 'not-materialised',
        },
      },
    );
  }
  return namespace.qualifyTable(table.name);
}

function renderTableSource(source: TableSource, ctx: RenderContext): string {
  const qualified = qualifyTable(source, ctx);
  return source.alias ? `${qualified} AS ${quoteIdentifier(source.alias)}` : qualified;
}

function renderSource(source: AnyFromSource, ctx: RenderContext): string {
  switch (source.kind) {
    case 'table-source':
      return renderTableSource(source, ctx);
    case 'derived-table-source':
      return `(${renderSelect(source.query, ctx)}) AS ${quoteIdentifier(source.alias)}`;
    case 'function-source':
      throw unsupported(
        'function-source',
        `MySQL cannot select from the set-returning function ${source.fn}`,
      );
    default:
      return assertNever(source, `Unsupported source node kind: ${nodeKind(source)}`);
  }
}

function renderExpr(expr: AnyExpression, ctx: RenderContext): string {
  switch (expr.kind) {
    case 'column-ref':
      return renderColumn(expr);
    case 'identifier-ref':
      return quoteIdentifier(expr.name);
    case 'operation':
      return renderOperation(expr, ctx);
    case 'subquery':
      return renderSubquery(expr, ctx);
    case 'aggregate':
      return renderAggregate(expr, ctx);
    case 'window-func':
      return renderWindowFunc(expr, ctx);
    case 'function-call':
      return renderFunctionCall(expr, ctx);
    case 'cast':
      return renderCast(expr, ctx);
    case 'case':
      return renderCase(expr, ctx);
    case 'json-object':
      return renderJsonObject(expr, ctx);
    case 'json-array-agg':
      return renderJsonArrayAgg(expr, ctx);
    case 'binary':
      return renderBinary(expr, ctx);
    case 'and':
      return expr.exprs.length === 0
        ? 'TRUE'
        : `(${expr.exprs.map((part) => renderExpr(part, ctx)).join(' AND ')})`;
    case 'or':
      return expr.exprs.length === 0
        ? 'FALSE'
        : `(${expr.exprs.map((part) => renderExpr(part, ctx)).join(' OR ')})`;
    case 'exists':
      return `${expr.notExists ? 'NOT ' : ''}EXISTS (${renderSelect(expr.subquery, ctx)})`;
    case 'null-check':
      return renderNullCheck(expr, ctx);
    case 'not':
      return `NOT (${renderExpr(expr.expr, ctx)})`;
    case 'param-ref':
    case 'prepared-param-ref':
      return renderParam(expr, ctx);
    case 'literal':
      return renderLiteral(expr);
    case 'list':
      return renderList(expr, ctx);
    case 'raw-expr':
      return renderParts(expr.parts, ctx);
    default:
      return assertNever(expr, `Unsupported expression node kind: ${nodeKind(expr)}`);
  }
}

/** Refuses raw SQL text that puts a digit right after an interpolated value: the value's `?N` and the digit would read as one larger placeholder, `?1` and `0` as `?10`. */
function assertNoDigitAfterParam(parts: RawExpr['parts'] | RawQueryAst['parts']): void {
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    const isParam =
      typeof part !== 'string' && (part.kind === 'param-ref' || part.kind === 'prepared-param-ref');
    if (isParam && typeof next === 'string' && /^\d/.test(next)) {
      throw structuredError(
        'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        "Raw SQL puts a digit right after an interpolated value, which MySQL lowering would read as part of the value's placeholder",
        {
          why: 'Each value is written as a numbered placeholder, ?N, so a digit that follows it in the SQL text makes a different placeholder: ?1 followed by 0 reads as ?10.',
          fix: 'Put a space or an operator between the interpolated value and the digit.',
          meta: { reason: 'digit-after-value', part: index + 1 },
        },
      );
    }
  });
}

function isParamPart(part: RawExpr['parts'][number]): part is AnyParamRef {
  return (
    typeof part !== 'string' && (part.kind === 'param-ref' || part.kind === 'prepared-param-ref')
  );
}

const isKeyword = (token: MysqlSqlToken | undefined, keyword: string): boolean =>
  token?.kind === 'word' && token.text.toUpperCase() === keyword;

const isIntegerLiteral = (token: MysqlSqlToken | undefined): boolean =>
  token?.kind === 'word' && [...token.text].every((char) => char >= '0' && char <= '9');

/**
 * The raw parts that are the operand of `LIMIT` or `OFFSET`, which MySQL takes only as a bare placeholder: a param whose previous token, past whitespace and comments, is `LIMIT` or `OFFSET`, or is the comma of `LIMIT a, b` after an integer or a param that is itself an operand. The raw text is read with the target's lexer, so a keyword inside a quoted string or a comment does not count.
 */
function limitOperandParts(parts: RawExpr['parts'] | RawQueryAst['parts']): ReadonlySet<number> {
  const sql = parts
    .map((part, index) =>
      typeof part === 'string' ? part : isParamPart(part) ? `?${index + 1}` : ' 0 ',
    )
    .join('');
  const tokens = tokenizeMysqlSql(sql).filter(
    (token) => token.kind !== 'whitespace' && token.kind !== 'comment',
  );
  const partOf = (token: MysqlPlaceholderToken) => (token.number ?? 0) - 1;
  const operands = new Set<number>();
  tokens.forEach((token, position) => {
    if (token.kind !== 'placeholder') return;
    const [third, second, first] = [
      tokens[position - 3],
      tokens[position - 2],
      tokens[position - 1],
    ];
    const afterKeyword = isKeyword(first, 'LIMIT') || isKeyword(first, 'OFFSET');
    const afterLimitComma =
      first?.kind === 'symbol' &&
      first.text === ',' &&
      ((isIntegerLiteral(second) && isKeyword(third, 'LIMIT')) ||
        (second?.kind === 'placeholder' && operands.has(partOf(second))));
    if (afterKeyword || afterLimitComma) operands.add(partOf(token));
  });
  return operands;
}

function renderParts(parts: RawExpr['parts'] | RawQueryAst['parts'], ctx: RenderContext): string {
  assertNoDigitAfterParam(parts);
  const limitOperands = limitOperandParts(parts);
  return parts
    .map((part, index) => {
      if (typeof part === 'string') return part;
      return isParamPart(part) && limitOperands.has(index)
        ? placeholder(part, ctx)
        : renderExpr(part, ctx);
    })
    .join('');
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

/**
 * A literal the code wrote: a number, a bigint, a boolean or NULL, such as the ORM's `1` and `fns.and(true, …)`. A `LiteralExpr` does not say where its value came from, and no part of Prisma writes a text, date or JSON literal into a MySQL runtime statement, so those are refused: a value of that kind can only be a caller's, which belongs in a param, sent apart from the SQL.
 */
function renderLiteral(expr: LiteralExpr): string {
  const { value } = expr;
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unsupported('non-finite-number', `MySQL has no literal for ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return String(value);
  throw unsupported(
    'value-literal',
    `MySQL lowering writes only numbers, booleans and NULL as literals; a ${value instanceof Date ? 'date' : Array.isArray(value) ? 'array' : typeof value} value must be a param`,
  );
}

/** Renders each `{{self}}` and `{{argN}}` where the template writes it. */
function renderOperation(expr: OperationExpr, ctx: RenderContext): string {
  return expr.lowering.template.replace(/\{\{(self|arg(\d+))\}\}/g, (_match, _name, index) => {
    if (index === undefined) return renderExpr(expr.self, ctx);
    const arg = expr.args[Number(index)];
    return arg === undefined ? '' : renderExpr(arg, ctx);
  });
}

function renderSubquery(expr: SubqueryExpr, ctx: RenderContext): string {
  if (expr.query.projection.length !== 1) {
    throw structuredError(
      'RUNTIME.AST_INVALID',
      'Subquery expressions must project exactly one column',
      { meta: { node: 'subquery' } },
    );
  }
  return `(${renderSelect(expr.query, ctx)})`;
}

/** Whether an operand must be parenthesised before an operator is written after it. A new expression kind fails to compile here until someone decides. */
function needsGrouping(expr: AnyExpression): boolean {
  switch (expr.kind) {
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

function grouped(expr: AnyExpression, ctx: RenderContext): string {
  const rendered = renderExpr(expr, ctx);
  return needsGrouping(expr) ? `(${rendered})` : rendered;
}

function renderNullCheck(expr: NullCheckExpr, ctx: RenderContext): string {
  return `${grouped(expr.expr, ctx)} ${expr.isNull ? 'IS NULL' : 'IS NOT NULL'}`;
}

const BINARY_OPERATORS: Readonly<Record<Exclude<BinaryExpr['op'], 'isDistinctFrom'>, string>> = {
  eq: '=',
  neq: '<>',
  isNotDistinctFrom: '<=>',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'LIKE',
  in: 'IN',
  notIn: 'NOT IN',
};

function renderBinary(expr: BinaryExpr, ctx: RenderContext): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') return 'FALSE';
    if (expr.op === 'notIn') return 'TRUE';
  }
  const left = grouped(expr.left, ctx);
  const right = renderExpr(expr.right, ctx);
  if (expr.op === 'isDistinctFrom') return `NOT (${left} <=> ${right})`;
  return `${left} ${BINARY_OPERATORS[expr.op]} ${right}`;
}

function renderList(expr: ListExpression, ctx: RenderContext): string {
  if (expr.values.length === 0) return '(NULL)';
  return `(${expr.values.map((value) => renderExpr(value, ctx)).join(', ')})`;
}

function renderAggregate(expr: AggregateExpr, ctx: RenderContext): string {
  const fn = expr.fn.toUpperCase();
  return expr.expr ? `${fn}(${renderExpr(expr.expr, ctx)})` : `${fn}(*)`;
}

function renderWindowFunc(expr: WindowFuncExpr, ctx: RenderContext): string {
  const args = expr.args.map((arg) => renderExpr(arg, ctx)).join(', ');
  const over = [
    expr.partitionBy?.length
      ? `PARTITION BY ${expr.partitionBy.map((e) => renderExpr(e, ctx)).join(', ')}`
      : '',
    expr.orderBy?.length ? `ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');
  return `${expr.fn.toUpperCase()}(${args}) OVER (${over})`;
}

function renderFunctionCall(expr: FunctionCallExpr, ctx: RenderContext): string {
  return `${expr.fn}(${expr.args.map((arg) => renderExpr(arg, ctx)).join(', ')})`;
}

function renderCast(expr: CastExpr, ctx: RenderContext): string {
  return `CAST(${renderExpr(expr.expr, ctx)} AS ${expr.targetType})`;
}

function renderCase(expr: CaseExpr, ctx: RenderContext): string {
  const branches = expr.branches
    .map(
      (branch) => `WHEN ${renderExpr(branch.condition, ctx)} THEN ${renderExpr(branch.value, ctx)}`,
    )
    .join(' ');
  const elseClause = expr.elseExpr === undefined ? '' : ` ELSE ${renderExpr(expr.elseExpr, ctx)}`;
  return `CASE ${branches}${elseClause} END`;
}

function descriptorOf(codec: CodecRef, ctx: RenderContext, use: string) {
  const descriptor = ctx.codecs.descriptorFor(codec.codecId);
  if (descriptor === undefined) {
    throw structuredError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `MySQL lowering: ${use} carries codecId "${codec.codecId}" but the MySQL codec registry has no entry for it. Register the extension pack that contributes this codec.`,
      { meta: { codecId: codec.codecId } },
    );
  }
  return descriptor;
}

/**
 * The `CAST` target of a param by its codec's data type. mysql2 sends a bigint as text, so where no column gives the param a type MySQL reads an integer as a string: `?1 < ?2` with 10 and 9 compares text, and `JSON_ARRAY(?1)` holds `"5"`. Casting keeps it an integer everywhere except `LIMIT` and `OFFSET`, which take only a bare placeholder and read it as an integer.
 */
const PARAMETER_CASTS: ReadonlyMap<string, string> = new Map([
  [mysqlInt.id, 'SIGNED'],
  [mysqlBigint.id, 'SIGNED'],
]);

function placeholder(ref: AnyParamRef, ctx: RenderContext): string {
  const number = ctx.placeholderNumbers.get(ref);
  if (number === undefined) {
    throw new InternalError('A param was written that the AST does not collect');
  }
  return `?${number}`;
}

function renderParam(ref: AnyParamRef, ctx: RenderContext): string {
  const castType =
    ref.codec === undefined
      ? undefined
      : PARAMETER_CASTS.get(descriptorOf(ref.codec, ctx, 'a parameter').dataType);
  const written = placeholder(ref, ctx);
  return castType === undefined ? written : `CAST(${written} AS ${castType})`;
}

function projectThroughCodec(
  value: ProjectionExpr,
  codec: CodecRef,
  ctx: RenderContext,
): ProjectionExpr {
  return descriptorOf(codec, ctx, 'a JSON projection').projectJson(value, codec);
}

function renderJsonValue(projection: AnyJsonValueProjection, ctx: RenderContext): string {
  const visitor: JsonValueProjectionVisitor<string> = {
    codec: ({ value, codec }) => renderExpr(projectThroughCodec(value, codec, ctx), ctx),
    native: ({ value }) => renderExpr(value, ctx),
    document: ({ value }) => renderExpr(value, ctx),
  };
  return projection.accept(visitor);
}

function renderJsonObject(expr: JsonObjectExpr, ctx: RenderContext): string {
  const args = expr.entries
    .flatMap((entry) => [`'${escapeLiteral(entry.key)}'`, renderJsonValue(entry.value, ctx)])
    .join(', ');
  return `JSON_OBJECT(${args})`;
}

/**
 * The element of an ordered JSON array, as JSON text. A document already is JSON; a scalar goes through `JSON_ARRAY`, so a string arrives quoted and escaped.
 */
function renderJsonElementText(projection: AnyJsonValueProjection, ctx: RenderContext): string {
  const rendered = renderJsonValue(projection, ctx);
  return projection.kind === 'document'
    ? rendered
    : `JSON_EXTRACT(JSON_ARRAY(${rendered}), '$[0]')`;
}

/**
 * `JSON_ARRAYAGG` takes no `ORDER BY`, and MySQL drops a derived table's `ORDER BY` when the outer query aggregates, so an ordered array is built as text with `GROUP_CONCAT`, which keeps its own order, and cast to JSON. The statement raises `group_concat_max_len` past any result a connection can send (see `GROUP_CONCAT_HINT`), so `GROUP_CONCAT` never cuts the text short. Text longer than `max_allowed_packet` makes `CONCAT` return NULL with only a warning, which would read as an empty include; so an empty array is written only when there are no rows, and a NULL text with rows is replaced by text that is not JSON, which fails the cast and the statement with MySQL's invalid-JSON error. `JSON_ARRAYAGG` fails on its own when its result exceeds a packet. An empty array is `JSON_ARRAY()`, so the column stays JSON and a nested include stays an array.
 */
function renderJsonArrayAgg(expr: JsonArrayAggExpr, ctx: RenderContext): string {
  if (expr.orderBy === undefined) {
    const aggregated = `JSON_ARRAYAGG(${renderJsonValue(expr.expr, ctx)})`;
    return expr.onEmpty === 'emptyArray' ? `COALESCE(${aggregated}, JSON_ARRAY())` : aggregated;
  }
  ctx.uses.groupConcat = true;
  const text = `CONCAT('[', GROUP_CONCAT(${renderJsonElementText(expr.expr, ctx)} ORDER BY ${renderOrderByItems(expr.orderBy, ctx)} SEPARATOR ','), ']')`;
  const empty = expr.onEmpty === 'emptyArray' ? 'JSON_ARRAY()' : 'NULL';
  return `CASE WHEN COUNT(*) = 0 THEN ${empty} ELSE CAST(COALESCE(${text}, ${OVERSIZED_ARRAY_TEXT}) AS JSON) END`;
}

/** Text that is not JSON, written in place of an array MySQL could not build because it is larger than a packet, so the cast fails. MySQL's error does not show this text: the user sees `Invalid JSON text in argument 1 to function cast_as_json`, which names neither the include nor the packet size. The text counts the rows only so that MySQL evaluates it when it is reached, not while preparing the statement. */
const OVERSIZED_ARRAY_TEXT = "CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')";

const ORDER_DIRECTION: Readonly<Record<OrderByItem['dir'], string>> = { asc: 'ASC', desc: 'DESC' };

/** A NULLS FIRST or NULLS LAST placement, which MySQL lacks, as a leading `IS NULL` sort key. */
const NULLS_KEY_DIRECTION: Readonly<Record<NonNullable<OrderByItem['nulls']>, string>> = {
  first: 'DESC',
  last: 'ASC',
};

function renderOrderByItem(item: OrderByItem, ctx: RenderContext): string {
  const nullsKey =
    item.nulls === undefined
      ? ''
      : `${grouped(item.expr, ctx)} IS NULL ${NULLS_KEY_DIRECTION[item.nulls]}, `;
  return `${nullsKey}${renderExpr(item.expr, ctx)} ${ORDER_DIRECTION[item.dir]}`;
}

function renderOrderByItems(items: ReadonlyArray<OrderByItem>, ctx: RenderContext): string {
  return items.map((item) => renderOrderByItem(item, ctx)).join(', ');
}

function renderJoin(join: JoinAst, ctx: RenderContext): string {
  if (join.joinType === 'full') {
    throw unsupported('full-join', 'MySQL has no FULL JOIN');
  }
  if (join.lateral) {
    throw unsupported('lateral-join', 'LATERAL joins are not supported on MySQL yet');
  }
  return `${join.joinType.toUpperCase()} JOIN ${renderSource(join.source, ctx)} ON ${renderJoinOn(join.on, ctx)}`;
}

function renderJoinOn(on: JoinOnExpr, ctx: RenderContext): string {
  return on.kind === 'eq-col-join-on'
    ? `${renderColumn(on.left)} = ${renderColumn(on.right)}`
    : renderExpr(on, ctx);
}
