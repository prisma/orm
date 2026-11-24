import type { AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { MockRuntime } from '../helpers';
import { printExpression } from './print-expression';

function printStatement(ast: AnyQueryAst): string {
  if (ast.kind !== 'delete' && ast.kind !== 'update' && ast.kind !== 'select') {
    return ast.kind;
  }
  const table =
    ast.kind === 'select'
      ? ast.from?.kind === 'table-source'
        ? ast.from.name
        : ''
      : ast.table.name;
  const joins =
    ast.kind === 'select'
      ? (ast.joins ?? []).map(({ joinType, source }) =>
          source.kind === 'table-source' ? ` ${joinType} join ${source.name}` : '',
        )
      : [];
  const where = ast.where === undefined ? '' : ` where ${printExpression(ast.where, table)}`;
  const limit =
    ast.kind !== 'select' || ast.limit === undefined
      ? ''
      : ` limit ${typeof ast.limit === 'number' ? ast.limit : printExpression(ast.limit, table)}`;
  const returning =
    ast.kind === 'select' || ast.returning === undefined
      ? ''
      : ` returning ${ast.returning.map(({ alias }) => alias).join(', ')}`;
  return `${ast.kind} ${table}${joins.join('')}${where}${limit}${returning}`;
}

/** The statements the mock runtime was sent, in order, printed compactly. */
export function sent(runtime: MockRuntime): string[] {
  return runtime.executions.map(({ plan }) => ('ast' in plan ? printStatement(plan.ast) : ''));
}
