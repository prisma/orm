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
import type { MysqlRuntimeTargetMeta } from '@internal/target-mysql/runtime';
import { escapeLiteral, quoteIdentifier } from '@internal/target-mysql/sql-utils';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { assertPlaceholdersMatchParams } from './placeholders';

export type MysqlContract = Contract<SqlStorage>;

/** A statement that can carry `RETURNING`. */
export type ReturningStatement = 'insert' | 'update' | 'delete';

const ARTICLED_STATEMENT: Readonly<Record<ReturningStatement, string>> = {
  insert: 'an insert',
  update: 'an update',
  delete: 'a delete',
};

/** How an upsert names the row it proposes: the alias it declares after the inserted rows, if any, and how its assignments read a column of that row, given the column's quoted name. */
export interface ProposedRow {
  readonly alias: string | undefined;
  readonly column: (quotedColumn: string) => string;
}

interface RenderContext {
  readonly contract: MysqlContract | undefined;
  readonly codecs: MysqlCodecDescriptorRegistry;
  /** Each param's placeholder number: its position in `collectOrderedParamRefs`, the order the runtime encodes params in. */
  readonly placeholderNumbers: ReadonlyMap<AnyParamRef, number>;
  /** Set when the statement builds an array with `GROUP_CONCAT`, whose length limit the statement then raises itself. */
  readonly uses: { groupConcat: boolean };
  /** While an insert is written: its table's alias, and the name a column of the table is qualified with instead, since MySQL's `INSERT` takes no table alias. */
  readonly insertInto?: { readonly alias: string; readonly name: string };
  /** While an update or delete is written after its target: the target's qualified name, which its `SET` and `WHERE` may not read on MySQL. */
  readonly writtenTable?: string;
}

/** The name an upsert gives the row it proposes, which its update reads as `new`.`column`; the ORM writes that row as `excluded`, as Postgres names it. */
const PROPOSED_ROW = quoteIdentifier('new');

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
 * Lowers a query AST to MySQL SQL. Each param is written as `?N`, N being its position in `collectOrderedParamRefs`, the order the runtime encodes and middleware edits params in; a param written twice is bound once. The driver fills the placeholders. It is built with the target it renders for, whose id its errors carry and whose display name its messages show. A target that extends MySQL subclasses it and overrides the protected methods where its SQL or its messages differ.
 */
export class MysqlSqlRenderer {
  constructor(
    private readonly codecs: MysqlCodecDescriptorRegistry,
    protected readonly target: Pick<MysqlRuntimeTargetMeta<string>, 'targetId' | 'displayName'>,
  ) {}

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

  /** How an upsert names the row it proposes: MySQL declares it `AS new` and reads `new`.`column`. */
  protected proposedRow(): ProposedRow {
    return { alias: PROPOSED_ROW, column: (quotedColumn) => `${PROPOSED_ROW}.${quotedColumn}` };
  }

  /** Why `RETURNING` on `statement` is refused: MySQL has none, so the SQL family's ORM reads written rows back with a select when the contract does not report `returning`. */
  protected returningRefusal(statement: ReturningStatement): string {
    return `${this.target.displayName} cannot return the rows ${ARTICLED_STATEMENT[statement]} writes; it has no RETURNING`;
  }

  /** Why an ordered JSON array is refused, or `undefined` where the renderer builds it, as MySQL's does. */
  protected orderedJsonArrayRefusal(): string | undefined {
    return undefined;
  }

  /** Why an update or delete whose `SET` or `WHERE` reads `table`, the table it writes, is refused, or `undefined` where the database runs it. MySQL refuses it with error 1093. The only form MySQL accepts reads the table through a derived table, which copies the table and locks every row it copies, so concurrent writes can deadlock; the renderer does not write it. */
  protected writtenTableReadRefusal(table: string): string | undefined {
    return `${this.target.displayName} cannot run an UPDATE or DELETE whose filter or values read the table being written, ${table}`;
  }

  /** Puts `GROUP_CONCAT_HINT` on the outermost `SELECT`; a statement without one would leave `GROUP_CONCAT` at the session's limit, which can cut an array after an element and still read as JSON, so it is refused. */
  private withGroupConcatHint(ast: AnyQueryAst, rendered: string): string {
    if (ast.kind !== 'select' || !rendered.startsWith('SELECT ')) {
      throw this.unsupported(
        'ordered-array-outside-select',
        `${this.target.displayName} can build an ordered JSON array only in a SELECT statement, whose outermost SELECT carries the hint that raises group_concat_max_len`,
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

  private unsupported(
    feature: string,
    message: string,
    guidance?: { readonly why: string; readonly fix: string },
  ): Error {
    return mysqlError('RUNTIME.AST_UNSUPPORTED', message, {
      ...guidance,
      meta: { target: this.target.targetId, feature },
    });
  }

  private refuseReturning(
    returning: ReadonlyArray<ProjectionItem> | undefined,
    statement: ReturningStatement,
  ): void {
    if (returning !== undefined && returning.length > 0) {
      throw this.unsupported('returning', this.returningRefusal(statement));
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
    this.refuseReturning(ast.returning, 'insert');
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
        throw this.unsupported(
          'insert-on-conflict-skip',
          `${this.target.displayName} cannot skip a conflicting row without also hiding other errors: INSERT IGNORE turns foreign-key and NOT NULL errors into warnings`,
        );
      case 'do-update-set': {
        if (conflict.columns.length > 0) {
          throw this.unsupported(
            'insert-on-conflict-target',
            `${this.target.displayName} cannot limit ON DUPLICATE KEY UPDATE to named conflict columns: it fires on any unique key`,
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
        const { alias } = this.proposedRow();
        return `${insert}${alias === undefined ? '' : ` AS ${alias}`} ON DUPLICATE KEY UPDATE ${set}`;
      }
      default:
        return assertNever(action, `Unsupported conflict action: ${nodeKind(action)}`);
    }
  }

  private renderUpdate(ast: UpdateAst, ctx: RenderContext): string {
    this.refuseReturning(ast.returning, 'update');
    const assignments = Object.entries(ast.set);
    if (assignments.length === 0)
      throw invalid('update', 'UPDATE requires at least one column to set');
    const target = this.renderTableSource(ast.table, ctx);
    const writeCtx = this.writing(ast.table, ctx);
    const set = assignments
      .map(([column, value]) => `${quoteIdentifier(column)} = ${this.renderExpr(value, writeCtx)}`)
      .join(', ');
    const where = ast.where ? ` WHERE ${this.renderExpr(ast.where, writeCtx)}` : '';
    return `UPDATE ${target} SET ${set}${where}`;
  }

  private renderDelete(ast: DeleteAst, ctx: RenderContext): string {
    this.refuseReturning(ast.returning, 'delete');
    const target = this.renderTableSource(ast.table, ctx);
    const where = ast.where
      ? ` WHERE ${this.renderExpr(ast.where, this.writing(ast.table, ctx))}`
      : '';
    return `DELETE FROM ${target}${where}`;
  }

  private writing(table: TableSource, ctx: RenderContext): RenderContext {
    return { ...ctx, writtenTable: this.qualifyTable(table, ctx) };
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
      throw this.unsupported(
        'locking-clause',
        `Row locks are not supported on ${this.target.displayName} yet, so a select cannot carry a locking clause such as FOR UPDATE`,
      );
    }
    if (ast.distinctOn !== undefined && ast.distinctOn.length > 0) {
      throw this.unsupported('distinct-on', `${this.target.displayName} has no DISTINCT ON`);
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
      case 'table-source': {
        const qualified = this.qualifyTable(source, ctx);
        const refusal =
          qualified === ctx.writtenTable ? this.writtenTableReadRefusal(qualified) : undefined;
        if (refusal !== undefined) {
          throw this.unsupported('write-reads-written-table', refusal, {
            why: `${this.target.displayName} refuses such a statement with its error 1093.`,
            fix: 'Read the keys of the rows, and any values the write takes from this table, with a query first. Then update or delete those rows by key, writing those values; for a variant, one row at a time with update or delete. The filter is not checked again when the rows are written.',
          });
        }
        return this.renderTableSource(source, ctx);
      }
      case 'derived-table-source':
        return `(${this.renderSelect(source.query, ctx)}) AS ${quoteIdentifier(source.alias)}`;
      case 'function-source':
        throw this.unsupported(
          'function-source',
          `${this.target.displayName} cannot select from the set-returning function ${source.fn}`,
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
          "Raw SQL puts a digit right after an interpolated value, which would become part of the value's placeholder",
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
      if (ref.table === 'excluded') return this.proposedRow().column(column);
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
        throw this.unsupported(
          'non-finite-number',
          `${this.target.displayName} has no literal for ${value}`,
        );
      }
      return String(value);
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'bigint') return String(value);
    const kind = value instanceof Date ? 'date' : Array.isArray(value) ? 'array' : typeof value;
    throw this.unsupported(
      'value-literal',
      `Prisma writes only numbers, booleans and NULL into ${this.target.displayName} SQL as literals, and this query has ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} literal; pass the value as a parameter instead`,
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
        `${use} uses codec "${codec.codecId}", which no extension given to the client provides.`,
        {
          fix: `Add the extension that provides codec "${codec.codecId}" to the client's \`extensions\`.`,
          meta: { codecId: codec.codecId },
        },
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
    if (ref.codec !== undefined) this.descriptorOf(ref.codec, ctx, 'A value in this query');
    return this.placeholder(ref, ctx);
  }

  private projectThroughCodec(
    value: ProjectionExpr,
    codec: CodecRef,
    ctx: RenderContext,
  ): ProjectionExpr {
    return this.descriptorOf(codec, ctx, 'A column this query reads in an include').projectJson(
      value,
      codec,
    );
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
    const refusal = this.orderedJsonArrayRefusal();
    if (refusal !== undefined) throw this.unsupported('ordered-json-array', refusal);
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
      throw this.unsupported('full-join', `${this.target.displayName} has no FULL JOIN`);
    }
    if (join.lateral) {
      throw this.unsupported(
        'lateral-join',
        `LATERAL joins are not supported on ${this.target.displayName} yet`,
      );
    }
    return `${join.joinType.toUpperCase()} JOIN ${this.renderSource(join.source, ctx)} ON ${this.renderJoinOn(join.on, ctx)}`;
  }

  private renderJoinOn(on: JoinOnExpr, ctx: RenderContext): string {
    return on.kind === 'eq-col-join-on'
      ? `${this.renderColumn(on.left, ctx)} = ${this.renderColumn(on.right, ctx)}`
      : this.renderExpr(on, ctx);
  }
}
