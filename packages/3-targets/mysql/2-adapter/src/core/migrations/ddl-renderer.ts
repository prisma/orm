import { checkSqlDefaultText } from '@internal/family-sql/control';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { REFERENTIAL_ACTION_SQL } from '@internal/sql-contract/referential-action-sql';
import {
  type CodecRef,
  type DdlColumn,
  type DdlTableConstraint,
  encodeLiteralDefault,
  type FunctionColumnDefault,
  type LiteralColumnDefault,
  type LiteralDefaultColumn,
  renderOpaqueSql,
  type SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import {
  encodeMysqlDatetime,
  mysqlCurrentValueFor,
  mysqlNowExpression,
} from '@internal/target-mysql/codecs';
import type { MysqlCreateTable } from '@internal/target-mysql/ddl';
import { quoteIdentifier, quoteLiteral } from '@internal/target-mysql/sql-utils';
import { structuredError } from '@internal/utils/structured-error';

/** Column types MySQL gives a default only when it is written as an expression in parentheses. */
const EXPRESSION_DEFAULT_ONLY = /^(?:(?:tiny|medium|long)?(?:text|blob)|json|geometry)\b/i;

const FRACTIONAL_SECONDS = /^(?:datetime|timestamp|time)\((\d)\)$/i;

function refusedDefault(where: LiteralDefaultColumn, why: string): never {
  throw structuredError(
    'CONTRACT.DEFAULT_INVALID',
    `Column "${where.table}"."${where.column}" has a default MySQL cannot store: ${why}`,
    { meta: { table: where.table, column: where.column } },
  );
}

/** A wire value as the SQL literal MySQL reads for it. */
export function mysqlInlineLiteral(wire: unknown, where: LiteralDefaultColumn): string {
  if (wire === null) return 'NULL';
  if (typeof wire === 'boolean') return wire ? '1' : '0';
  if (typeof wire === 'number') {
    if (!Number.isFinite(wire)) return refusedDefault(where, `${wire} is not a finite number`);
    return String(wire);
  }
  if (typeof wire === 'bigint') return String(wire);
  if (typeof wire === 'string') return quoteLiteral(wire);
  if (wire instanceof Date) return quoteLiteral(encodeMysqlDatetime(wire));
  if (wire instanceof Uint8Array) return `X'${Buffer.from(wire).toString('hex')}'`;
  if (typeof wire === 'object') return quoteLiteral(JSON.stringify(wire));
  return refusedDefault(where, `a ${typeof wire} has no SQL literal`);
}

function withinParentheses(columnType: string, literal: string): string {
  return EXPRESSION_DEFAULT_ONLY.test(columnType.trim()) ? `(${literal})` : literal;
}

/**
 * The expression a `now()` default is written as: the current value the column's data type holds, `CURRENT_TIMESTAMP`, `CURRENT_DATE` or `CURRENT_TIME`, with the column's fractional-second precision, which MySQL requires to match. A column of a data type that holds no date or time is refused.
 */
function nowExpressionFor(
  columnType: string,
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
  codecRef: CodecRef | undefined,
  where: LiteralDefaultColumn,
): string {
  const dataType =
    codecRef === undefined ? undefined : codecLookup.descriptorFor(codecRef.codecId)?.dataType;
  const current = mysqlCurrentValueFor(dataType);
  if (current === undefined) {
    throw structuredError(
      'CONTRACT.DEFAULT_INVALID',
      `The column "${where.table}"."${where.column}" has a now() default, but its data type ${dataType} stores no date or time, so there is no current value to write. Remove the default, or give the field a date or time type.`,
      {
        meta: {
          table: where.table,
          column: where.column,
          dataType,
          reason: 'now-default-not-date-or-time',
        },
      },
    );
  }
  const precision = FRACTIONAL_SECONDS.exec(columnType.trim())?.[1];
  return mysqlNowExpression(current, precision === undefined ? undefined : Number(precision));
}

/**
 * The `DEFAULT …` clause of a column, or `''` for an `autoincrement()` default, which a column writes as `AUTO_INCREMENT` instead. A literal is read by the column's codec, and a text or blob column's literal is written as an expression, as MySQL requires.
 */
export async function renderMysqlColumnDefault(
  def: LiteralColumnDefault | FunctionColumnDefault,
  columnType: string,
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
  codecRef: CodecRef | undefined,
  where: LiteralDefaultColumn,
): Promise<string> {
  if (def.kind === 'function') {
    const text = def.expression.text;
    if (text === 'autoincrement()') return '';
    if (text === 'now()') {
      return `DEFAULT (${nowExpressionFor(columnType, codecLookup, codecRef, where)})`;
    }
    if (checkSqlDefaultText(text) !== undefined) {
      throw structuredError(
        'CONTRACT.DEFAULT_INVALID',
        `Unsafe default expression in contract: "${text}". Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.`,
        { meta: { expression: text } },
      );
    }
    return `DEFAULT (${renderOpaqueSql(def.expression)})`;
  }
  const encoded =
    codecRef === undefined
      ? undefined
      : await encodeLiteralDefault(codecLookup, codecRef, def.value, where);
  if (encoded?.kind === 'sql-null') return 'DEFAULT NULL';
  const wire = encoded === undefined ? def.value : encoded.wire;
  return `DEFAULT ${withinParentheses(columnType, mysqlInlineLiteral(wire, where))}`;
}

function isAutoincrement(column: DdlColumn): boolean {
  return (
    column.default?.kind === 'function' && column.default.expression.text === 'autoincrement()'
  );
}

async function renderColumn(
  column: DdlColumn,
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
  table: string,
): Promise<string> {
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.notNull) parts.push('NOT NULL');
  if (column.default !== undefined) {
    const clause = await renderMysqlColumnDefault(
      column.default,
      column.type,
      codecLookup,
      column.codecRef,
      { table, column: column.name },
    );
    if (clause.length > 0) parts.push(clause);
  }
  if (isAutoincrement(column)) parts.push('AUTO_INCREMENT');
  if (column.primaryKey) parts.push('PRIMARY KEY');
  return parts.join(' ');
}

function columnList(columns: readonly string[]): string {
  return columns.map(quoteIdentifier).join(', ');
}

function named(name: string | undefined, body: string): string {
  return name === undefined ? body : `CONSTRAINT ${quoteIdentifier(name)} ${body}`;
}

function renderConstraint(constraint: DdlTableConstraint): string {
  switch (constraint.kind) {
    case 'primary-key':
      return named(constraint.name, `PRIMARY KEY (${columnList(constraint.columns)})`);
    case 'unique':
      return named(constraint.name, `UNIQUE (${columnList(constraint.columns)})`);
    case 'foreign-key': {
      const actions = [
        constraint.onDelete === undefined
          ? undefined
          : `ON DELETE ${REFERENTIAL_ACTION_SQL[constraint.onDelete]}`,
        constraint.onUpdate === undefined
          ? undefined
          : `ON UPDATE ${REFERENTIAL_ACTION_SQL[constraint.onUpdate]}`,
      ].filter((action) => action !== undefined);
      return named(
        constraint.name,
        [
          `FOREIGN KEY (${columnList(constraint.columns)}) REFERENCES ${quoteIdentifier(constraint.refTable)} (${columnList(constraint.refColumns)})`,
          ...actions,
        ].join(' '),
      );
    }
    case 'check-expression':
      throw structuredError(
        'CONTRACT.CONSTRAINT_INVALID',
        `The MySQL target does not write CHECK constraints yet (constraint "${constraint.name}").`,
        { meta: { constraintName: constraint.name } },
      );
  }
}

/** The `CREATE TABLE` statement of a MySQL DDL node. */
export async function renderMysqlCreateTable(
  node: MysqlCreateTable,
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): Promise<SqlExecuteRequest> {
  const columns = await Promise.all(
    node.columns.map((column) => renderColumn(column, codecLookup, node.table)),
  );
  const definitions = [...columns, ...(node.constraints ?? []).map(renderConstraint)];
  const ifNotExists = node.ifNotExists === true ? 'IF NOT EXISTS ' : '';
  return {
    sql: `CREATE TABLE ${ifNotExists}${quoteIdentifier(node.table)} (\n  ${definitions.join(',\n  ')}\n)`,
    params: [],
  };
}
