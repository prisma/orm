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
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import type { MysqlCodecDescriptorRegistry } from '@internal/target-mysql/codec-descriptor';
import { mysqlError } from '@internal/target-mysql/errors';
import { escapeLiteral, quoteIdentifier } from '@internal/target-mysql/sql-utils';
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
  /** While an insert is written: its table's alias, and the name a column of the table is qualified with instead, since MySQL's `INSERT` takes no table alias. */
  readonly insertInto?: { readonly alias: string; readonly name: string };
}

/** The name an upsert gives the row it proposes, which its update reads as `new`.`column`; the ORM writes that row as `excluded`, as Postgres names it. */
const PROPOSED_ROW = 'new';

/**
 * Raises `group_concat_max_len` for this statement only, past any result a connection can send, so an ordered include does not depend on how the driver set up its session. MySQL takes `SET_VAR` only on the outermost `SELECT`.
 */
const GROUP_CONCAT_HINT = '/*+ SET_VAR(group_concat_max_len = 4294967295) */';

/** MySQL's documented way to write an `OFFSET` with no `LIMIT`: the largest row count it takes. */
const NO_LIMIT = '18446744073709551615';

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

/** Text that is not JSON, written in place of an array MySQL could not build because it is larger than a packet, so the cast fails. MySQL's error does not show this text: the user sees `Invalid JSON text in argument 1 to function cast_as_json`, which names neither the include nor the packet size. The text counts the rows only so that MySQL evaluates it when it is reached, not while preparing the statement. */
const OVERSIZED_ARRAY_TEXT = "CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')";

const ORDER_DIRECTION: Readonly<Record<OrderByItem['dir'], string>> = { asc: 'ASC', desc: 'DESC' };

/** A NULLS FIRST or NULLS LAST placement, which MySQL lacks, as a leading `IS NULL` sort key. */
const NULLS_KEY_DIRECTION: Readonly<Record<NonNullable<OrderByItem['nulls']>, string>> = {
  first: 'DESC',
  last: 'ASC',
};

function nodeKind(value: unknown): string {
  return typeof value === 'object' && value !== null && 'kind' in value
    ? String(value.kind)
    : 'unknown';
}

function unsupported(feature: string, message: string): Error {
  return mysqlError('RUNTIME.AST_UNSUPPORTED', message, { meta: { target: 'mysql', feature } });
}

function invalid(node: string, message: string): Error {
  return mysqlError('RUNTIME.AST_INVALID', message, { meta: { node } });
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

/**
 * Lowers a query AST to MySQL SQL. Each param is written as `?N`, N being its position in `collectOrderedParamRefs`, the order the runtime encodes and middleware edits params in; a param written twice is bound once. The driver fills the placeholders. A database that extends MySQL subclasses it and overrides the protected methods, where its SQL differs.
 */
export class MysqlSqlRenderer {
  constructor(private readonly codecs: MysqlCodecDescriptorRegistry) {}

  render(ast: AnyQueryAst, contract: MysqlContract | undefined): LoweredStatement {
    const placeholderNumbers = new Map<AnyParamRef, number>();
    const params: LoweredParam[] = collectOrderedParamRefs(ast).map((ref, index) => {
      placeholderNumbers.set(ref, index + 1);
      return ref.kind === 'prepared-param-ref'
        ? { kind: 'bind', name: ref.name }
        : { kind: 'literal', value: ref.value };
    });
    const ctx: RenderContext = {
      contract,
      codecs: this.codecs,
      placeholderNumbers,
      uses: { groupConcat: false },
    };
    const rendered = this.renderStatement(ast, ctx);
    const sql = ctx.uses.groupConcat ? this.withGroupConcatHint(ast, rendered) : rendered;
    assertPlaceholdersMatchParams(sql, params.length);
    return Object.freeze({ sql, params });
  }

  /** The clause that makes an insert an upsert, given its assignments: the proposed row is named `new`, which the assignments read as `new`.`column`. */
  protected onDuplicateKeyUpdate(set: string): string {
    return `AS ${quoteIdentifier(PROPOSED_ROW)} ON DUPLICATE KEY UPDATE ${set}`;
  }

  /** How an upsert's assignments read a column of the row it proposes, given the column's quoted name. */
  protected proposedRowColumn(column: string): string {
    return `${quoteIdentifier(PROPOSED_ROW)}.${column}`;
  }

  /** Puts `GROUP_CONCAT_HINT` on the outermost `SELECT`; a statement without one would leave `GROUP_CONCAT` at the session's limit, which can cut an array after an element and still read as JSON, so it is refused. */
  private withGroupConcatHint(ast: AnyQueryAst, rendered: string): string {
    if (ast.kind !== 'select' || !rendered.startsWith('SELECT ')) {
      throw unsupported(
        'ordered-array-outside-select',
        'MySQL can build an ordered JSON array only in a SELECT statement, whose outermost SELECT carries the hint that raises group_concat_max_len',
      );
    }
    return `SELECT ${GROUP_CONCAT_HINT} ${rendered.slice('SELECT '.length)}`;
  }

  private renderStatement(ast: AnyQueryAst, ctx: RenderContext): string {
    switch (ast.kind) {
      case 'select':
        return this.renderSelect(ast, ctx);
      case 'raw-query':
        return this.renderParts(ast.parts, ctx);
      case 'insert':
        return this.renderInsert(ast, ctx);
      case 'update':
        return this.renderUpdate(ast, ctx);
      case 'delete':
        return this.renderDelete(ast, ctx);
      default:
        throw new InternalError(`Unsupported AST node kind: ${nodeKind(ast)}`);
    }
  }

  /** MySQL has no `RETURNING`: the SQL family's ORM reads written rows back with a select when the contract does not report `returning`. */
  private refuseReturning(
    returning: ReadonlyArray<ProjectionItem> | undefined,
    what: string,
  ): void {
    if (returning !== undefined && returning.length > 0) {
      throw unsupported(
        'returning',
        `MySQL cannot return the rows ${what} writes; it has no RETURNING`,
      );
    }
  }

  private renderInsertValue(value: InsertValue | undefined, ctx: RenderContext): string {
    if (value === undefined || value.kind === 'default-value') return 'DEFAULT';
    return this.renderExpr(value, ctx);
  }

  /**
   * An insert, with the bare table name: MySQL's `INSERT` takes no alias, so a column of the table is qualified by its name. A row without a value for a column gets `DEFAULT`. An upsert names its proposed row `new` and updates the existing row on any duplicate key. MySQL cannot limit `ON DUPLICATE KEY UPDATE` to named conflict columns, so the adapter does not report `insertOnConflictTarget` and an upsert that names them is refused. Skipping a conflicting row is refused: `INSERT IGNORE` also hides foreign-key and `NOT NULL` errors.
   */
  private renderInsert(ast: InsertAst, ctx: RenderContext): string {
    this.refuseReturning(ast.returning, 'an insert');
    if (ast.rows.length === 0) throw invalid('insert', 'INSERT requires at least one row');
    const table = this.qualifyTable(ast.table, ctx);
    const insertCtx: RenderContext = {
      ...ctx,
      insertInto: { alias: ast.table.alias ?? ast.table.name, name: table },
    };
    const columns = [...new Set(ast.rows.flatMap((row) => Object.keys(row)))];
    const values = ast.rows
      .map(
        (row) =>
          `(${columns.map((column) => this.renderInsertValue(row[column], insertCtx)).join(', ')})`,
      )
      .join(', ');
    const insert = `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(', ')}) VALUES ${values}`;
    const conflict = ast.onConflict;
    if (conflict === undefined) return insert;
    const action = conflict.action;
    switch (action.kind) {
      case 'do-nothing':
        throw unsupported(
          'insert-on-conflict-skip',
          'MySQL cannot skip a conflicting row without also hiding other errors: INSERT IGNORE turns foreign-key and NOT NULL errors into warnings',
        );
      case 'do-update-set': {
        if (conflict.columns.length > 0) {
          throw unsupported(
            'insert-on-conflict-target',
            'MySQL cannot limit ON DUPLICATE KEY UPDATE to named conflict columns: it fires on any unique key',
          );
        }
        const assignments = Object.entries(action.set);
        if (assignments.length === 0) {
          throw invalid('insert-on-conflict', 'An upsert requires at least one column to update');
        }
        const set = assignments
          .map(
            ([column, value]) =>
              `${quoteIdentifier(column)} = ${this.renderExpr(value, insertCtx)}`,
          )
          .join(', ');
        return `${insert} ${this.onDuplicateKeyUpdate(set)}`;
      }
      default:
        return assertNever(action, `Unsupported conflict action: ${nodeKind(action)}`);
    }
  }

  private renderUpdate(ast: UpdateAst, ctx: RenderContext): string {
    this.refuseReturning(ast.returning, 'an update');
    const assignments = Object.entries(ast.set);
    if (assignments.length === 0)
      throw invalid('update', 'UPDATE requires at least one column to set');
    const set = assignments
      .map(([column, value]) => `${quoteIdentifier(column)} = ${this.renderExpr(value, ctx)}`)
      .join(', ');
    const where = ast.where ? ` WHERE ${this.renderExpr(ast.where, ctx)}` : '';
    return `UPDATE ${this.renderTableSource(ast.table, ctx)} SET ${set}${where}`;
  }

  private renderDelete(ast: DeleteAst, ctx: RenderContext): string {
    this.refuseReturning(ast.returning, 'a delete');
    const where = ast.where ? ` WHERE ${this.renderExpr(ast.where, ctx)}` : '';
    return `DELETE FROM ${this.renderTableSource(ast.table, ctx)}${where}`;
  }

  private renderLimitOffset(
    keyword: 'LIMIT' | 'OFFSET',
    value: SelectAst['limit'],
    ctx: RenderContext,
  ): string {
    if (value === undefined) return '';
    if (typeof value === 'number') return `${keyword} ${value}`;
    const rendered =
      value.kind === 'param-ref' || value.kind === 'prepared-param-ref'
        ? this.placeholder(value, ctx)
        : this.renderExpr(value, ctx);
    return `${keyword} ${rendered}`;
  }

  private renderSelect(ast: SelectAst, ctx: RenderContext): string {
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
      `SELECT ${ast.distinct ? 'DISTINCT ' : ''}${this.renderProjection(ast.projection, ctx)}`,
      ast.from === undefined ? '' : `FROM ${this.renderSource(ast.from, ctx)}`,
      ast.joins?.length ? ast.joins.map((join) => this.renderJoin(join, ctx)).join(' ') : '',
      ast.where ? `WHERE ${this.renderExpr(ast.where, ctx)}` : '',
      ast.groupBy?.length
        ? `GROUP BY ${ast.groupBy.map((e) => this.renderExpr(e, ctx)).join(', ')}`
        : '',
      ast.having ? `HAVING ${this.renderExpr(ast.having, ctx)}` : '',
      ast.orderBy?.length ? `ORDER BY ${this.renderOrderByItems(ast.orderBy, ctx)}` : '',
      ast.limit === undefined && ast.offset !== undefined
        ? `LIMIT ${NO_LIMIT}`
        : this.renderLimitOffset('LIMIT', ast.limit, ctx),
      this.renderLimitOffset('OFFSET', ast.offset, ctx),
    ]
      .filter((part) => part.length > 0)
      .join(' ');
  }

  private renderProjection(projection: ReadonlyArray<ProjectionItem>, ctx: RenderContext): string {
    return projection
      .map((item) => `${this.renderExpr(item.expr, ctx)} AS ${quoteIdentifier(item.alias)}`)
      .join(', ');
  }

  private qualifyTable(
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

  private renderTableSource(source: TableSource, ctx: RenderContext): string {
    const qualified = this.qualifyTable(source, ctx);
    return source.alias ? `${qualified} AS ${quoteIdentifier(source.alias)}` : qualified;
  }

  private renderSource(source: AnyFromSource, ctx: RenderContext): string {
    switch (source.kind) {
      case 'table-source':
        return this.renderTableSource(source, ctx);
      case 'derived-table-source':
        return `(${this.renderSelect(source.query, ctx)}) AS ${quoteIdentifier(source.alias)}`;
      case 'function-source':
        throw unsupported(
          'function-source',
          `MySQL cannot select from the set-returning function ${source.fn}`,
        );
      default:
        return assertNever(source, `Unsupported source node kind: ${nodeKind(source)}`);
    }
  }

  private renderExpr(expr: AnyExpression, ctx: RenderContext): string {
    switch (expr.kind) {
      case 'column-ref':
        return this.renderColumn(expr, ctx);
      case 'identifier-ref':
        return quoteIdentifier(expr.name);
      case 'operation':
        return this.renderOperation(expr, ctx);
      case 'subquery':
        return this.renderSubquery(expr, ctx);
      case 'aggregate':
        return this.renderAggregate(expr, ctx);
      case 'window-func':
        return this.renderWindowFunc(expr, ctx);
      case 'function-call':
        return this.renderFunctionCall(expr, ctx);
      case 'cast':
        return this.renderCast(expr, ctx);
      case 'case':
        return this.renderCase(expr, ctx);
      case 'json-object':
        return this.renderJsonObject(expr, ctx);
      case 'json-array-agg':
        return this.renderJsonArrayAgg(expr, ctx);
      case 'binary':
        return this.renderBinary(expr, ctx);
      case 'and':
        return expr.exprs.length === 0
          ? 'TRUE'
          : `(${expr.exprs.map((part) => this.renderExpr(part, ctx)).join(' AND ')})`;
      case 'or':
        return expr.exprs.length === 0
          ? 'FALSE'
          : `(${expr.exprs.map((part) => this.renderExpr(part, ctx)).join(' OR ')})`;
      case 'exists':
        return `${expr.notExists ? 'NOT ' : ''}EXISTS (${this.renderSelect(expr.subquery, ctx)})`;
      case 'null-check':
        return this.renderNullCheck(expr, ctx);
      case 'not':
        return `NOT (${this.renderExpr(expr.expr, ctx)})`;
      case 'param-ref':
      case 'prepared-param-ref':
        return this.renderParam(expr, ctx);
      case 'literal':
        return this.renderLiteral(expr);
      case 'list':
        return this.renderList(expr, ctx);
      case 'raw-expr':
        return this.renderParts(expr.parts, ctx);
      default:
        return assertNever(expr, `Unsupported expression node kind: ${nodeKind(expr)}`);
    }
  }

  /** Refuses raw SQL text that puts a digit right after an interpolated value: the value's `?N` and the digit would read as one larger placeholder, `?1` and `0` as `?10`. */
  private assertNoDigitAfterParam(parts: RawExpr['parts'] | RawQueryAst['parts']): void {
    parts.forEach((part, index) => {
      const next = parts[index + 1];
      const isParam =
        typeof part !== 'string' &&
        (part.kind === 'param-ref' || part.kind === 'prepared-param-ref');
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

  private renderParts(parts: RawExpr['parts'] | RawQueryAst['parts'], ctx: RenderContext): string {
    this.assertNoDigitAfterParam(parts);
    return parts
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        switch (part.kind) {
          case 'select':
            return this.renderSelect(part, ctx);
          case 'insert':
            return this.renderInsert(part, ctx);
          case 'update':
            return this.renderUpdate(part, ctx);
          case 'delete':
            return this.renderDelete(part, ctx);
          default:
            return this.renderExpr(part, ctx);
        }
      })
      .join('');
  }

  private renderColumn(ref: ColumnRef, ctx: RenderContext): string {
    const column = quoteIdentifier(ref.column);
    const { insertInto } = ctx;
    if (insertInto !== undefined) {
      if (ref.table === 'excluded') return this.proposedRowColumn(column);
      if (ref.table === insertInto.alias) return `${insertInto.name}.${column}`;
    }
    return `${quoteIdentifier(ref.table)}.${column}`;
  }

  /**
   * A literal the code wrote: a number, a bigint, a boolean or NULL, such as the ORM's `1` and `fns.and(true, …)`. A `LiteralExpr` does not say where its value came from, and no part of Prisma writes a text, date or JSON literal into a MySQL runtime statement, so those are refused: a value of that kind can only be a caller's, which belongs in a param, sent apart from the SQL.
   */
  private renderLiteral(expr: LiteralExpr): string {
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
  private renderOperation(expr: OperationExpr, ctx: RenderContext): string {
    return expr.lowering.template.replace(/\{\{(self|arg(\d+))\}\}/g, (_match, _name, index) => {
      if (index === undefined) return this.renderExpr(expr.self, ctx);
      const arg = expr.args[Number(index)];
      return arg === undefined ? '' : this.renderExpr(arg, ctx);
    });
  }

  private renderSubquery(expr: SubqueryExpr, ctx: RenderContext, columns = 1): string {
    if (expr.query.projection.length !== columns) {
      throw structuredError(
        'RUNTIME.AST_INVALID',
        columns === 1
          ? 'Subquery expressions must project exactly one column'
          : `A subquery compared with a row value of ${columns} columns must project ${columns} columns`,
        { meta: { node: 'subquery' } },
      );
    }
    return `(${this.renderSelect(expr.query, ctx)})`;
  }

  private grouped(expr: AnyExpression, ctx: RenderContext): string {
    const rendered = this.renderExpr(expr, ctx);
    return needsGrouping(expr) ? `(${rendered})` : rendered;
  }

  private renderNullCheck(expr: NullCheckExpr, ctx: RenderContext): string {
    return `${this.grouped(expr.expr, ctx)} ${expr.isNull ? 'IS NULL' : 'IS NOT NULL'}`;
  }

  private renderBinary(expr: BinaryExpr, ctx: RenderContext): string {
    if (expr.right.kind === 'list' && expr.right.values.length === 0) {
      if (expr.op === 'in') return 'FALSE';
      if (expr.op === 'notIn') return 'TRUE';
    }
    const left = this.grouped(expr.left, ctx);
    const right =
      expr.right.kind === 'subquery' && expr.left.kind === 'list'
        ? this.renderSubquery(expr.right, ctx, expr.left.values.length)
        : this.renderExpr(expr.right, ctx);
    if (expr.op === 'isDistinctFrom') return `NOT (${left} <=> ${right})`;
    return `${left} ${BINARY_OPERATORS[expr.op]} ${right}`;
  }

  private renderList(expr: ListExpression, ctx: RenderContext): string {
    if (expr.values.length === 0) return '(NULL)';
    return `(${expr.values.map((value) => this.renderExpr(value, ctx)).join(', ')})`;
  }

  private renderAggregate(expr: AggregateExpr, ctx: RenderContext): string {
    const fn = expr.fn.toUpperCase();
    return expr.expr ? `${fn}(${this.renderExpr(expr.expr, ctx)})` : `${fn}(*)`;
  }

  private renderWindowFunc(expr: WindowFuncExpr, ctx: RenderContext): string {
    const args = expr.args.map((arg) => this.renderExpr(arg, ctx)).join(', ');
    const over = [
      expr.partitionBy?.length
        ? `PARTITION BY ${expr.partitionBy.map((e) => this.renderExpr(e, ctx)).join(', ')}`
        : '',
      expr.orderBy?.length ? `ORDER BY ${this.renderOrderByItems(expr.orderBy, ctx)}` : '',
    ]
      .filter((part) => part.length > 0)
      .join(' ');
    return `${expr.fn.toUpperCase()}(${args}) OVER (${over})`;
  }

  private renderFunctionCall(expr: FunctionCallExpr, ctx: RenderContext): string {
    return `${expr.fn}(${expr.args.map((arg) => this.renderExpr(arg, ctx)).join(', ')})`;
  }

  private renderCast(expr: CastExpr, ctx: RenderContext): string {
    return `CAST(${this.renderExpr(expr.expr, ctx)} AS ${expr.targetType})`;
  }

  private renderCase(expr: CaseExpr, ctx: RenderContext): string {
    const branches = expr.branches
      .map(
        (branch) =>
          `WHEN ${this.renderExpr(branch.condition, ctx)} THEN ${this.renderExpr(branch.value, ctx)}`,
      )
      .join(' ');
    const elseClause =
      expr.elseExpr === undefined ? '' : ` ELSE ${this.renderExpr(expr.elseExpr, ctx)}`;
    return `CASE ${branches}${elseClause} END`;
  }

  private descriptorOf(codec: CodecRef, ctx: RenderContext, use: string) {
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

  private placeholder(ref: AnyParamRef, ctx: RenderContext): string {
    const number = ctx.placeholderNumbers.get(ref);
    if (number === undefined) {
      throw new InternalError('A param was written that the AST does not collect');
    }
    return `?${number}`;
  }

  /** A param as its numbered placeholder, refusing one whose codec the MySQL registry lacks. */
  private renderParam(ref: AnyParamRef, ctx: RenderContext): string {
    if (ref.codec !== undefined) this.descriptorOf(ref.codec, ctx, 'a parameter');
    return this.placeholder(ref, ctx);
  }

  private projectThroughCodec(
    value: ProjectionExpr,
    codec: CodecRef,
    ctx: RenderContext,
  ): ProjectionExpr {
    return this.descriptorOf(codec, ctx, 'a JSON projection').projectJson(value, codec);
  }

  private renderJsonValue(projection: AnyJsonValueProjection, ctx: RenderContext): string {
    const visitor: JsonValueProjectionVisitor<string> = {
      codec: ({ value, codec }) =>
        this.renderExpr(this.projectThroughCodec(value, codec, ctx), ctx),
      native: ({ value }) => this.renderExpr(value, ctx),
      document: ({ value }) => this.renderExpr(value, ctx),
    };
    return projection.accept(visitor);
  }

  private renderJsonObject(expr: JsonObjectExpr, ctx: RenderContext): string {
    const args = expr.entries
      .flatMap((entry) => [`'${escapeLiteral(entry.key)}'`, this.renderJsonValue(entry.value, ctx)])
      .join(', ');
    return `JSON_OBJECT(${args})`;
  }

  /**
   * The element of an ordered JSON array, as JSON text. A document already is JSON; a scalar goes through `JSON_ARRAY`, so a string arrives quoted and escaped.
   */
  private renderJsonElementText(projection: AnyJsonValueProjection, ctx: RenderContext): string {
    const rendered = this.renderJsonValue(projection, ctx);
    return projection.kind === 'document'
      ? rendered
      : `JSON_EXTRACT(JSON_ARRAY(${rendered}), '$[0]')`;
  }

  /**
   * `JSON_ARRAYAGG` takes no `ORDER BY`, and MySQL drops a derived table's `ORDER BY` when the outer query aggregates, so an ordered array is built as text with `GROUP_CONCAT`, which keeps its own order, and cast to JSON. The statement raises `group_concat_max_len` past any result a connection can send (see `GROUP_CONCAT_HINT`), so `GROUP_CONCAT` never cuts the text short. Text longer than `max_allowed_packet` makes `CONCAT` return NULL with only a warning, which would read as an empty include; so an empty array is written only when there are no rows, and a NULL text with rows is replaced by text that is not JSON, which fails the cast and the statement with MySQL's invalid-JSON error. `JSON_ARRAYAGG` fails on its own when its result exceeds a packet. An empty array is `JSON_ARRAY()`, so the column stays JSON and a nested include stays an array.
   */
  private renderJsonArrayAgg(expr: JsonArrayAggExpr, ctx: RenderContext): string {
    if (expr.orderBy === undefined) {
      const aggregated = `JSON_ARRAYAGG(${this.renderJsonValue(expr.expr, ctx)})`;
      return expr.onEmpty === 'emptyArray' ? `COALESCE(${aggregated}, JSON_ARRAY())` : aggregated;
    }
    ctx.uses.groupConcat = true;
    const text = `CONCAT('[', GROUP_CONCAT(${this.renderJsonElementText(expr.expr, ctx)} ORDER BY ${this.renderOrderByItems(expr.orderBy, ctx)} SEPARATOR ','), ']')`;
    const empty = expr.onEmpty === 'emptyArray' ? 'JSON_ARRAY()' : 'NULL';
    return `CASE WHEN COUNT(*) = 0 THEN ${empty} ELSE CAST(COALESCE(${text}, ${OVERSIZED_ARRAY_TEXT}) AS JSON) END`;
  }

  private renderOrderByItem(item: OrderByItem, ctx: RenderContext): string {
    const nullsKey =
      item.nulls === undefined
        ? ''
        : `${this.grouped(item.expr, ctx)} IS NULL ${NULLS_KEY_DIRECTION[item.nulls]}, `;
    return `${nullsKey}${this.renderExpr(item.expr, ctx)} ${ORDER_DIRECTION[item.dir]}`;
  }

  private renderOrderByItems(items: ReadonlyArray<OrderByItem>, ctx: RenderContext): string {
    return items.map((item) => this.renderOrderByItem(item, ctx)).join(', ');
  }

  private renderJoin(join: JoinAst, ctx: RenderContext): string {
    if (join.joinType === 'full') {
      throw unsupported('full-join', 'MySQL has no FULL JOIN');
    }
    if (join.lateral) {
      throw unsupported('lateral-join', 'LATERAL joins are not supported on MySQL yet');
    }
    return `${join.joinType.toUpperCase()} JOIN ${this.renderSource(join.source, ctx)} ON ${this.renderJoinOn(join.on, ctx)}`;
  }

  private renderJoinOn(on: JoinOnExpr, ctx: RenderContext): string {
    return on.kind === 'eq-col-join-on'
      ? `${this.renderColumn(on.left, ctx)} = ${this.renderColumn(on.right, ctx)}`
      : this.renderExpr(on, ctx);
  }
}
