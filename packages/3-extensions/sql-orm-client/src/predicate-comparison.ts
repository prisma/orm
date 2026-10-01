import { type AnyExpression, BinaryExpr, type BinaryOp } from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';

export function predicateComparison(
  op: BinaryOp,
  left: AnyExpression,
  right: AnyExpression,
): BinaryExpr {
  const operands = right.kind === 'list' ? [left, ...right.values] : [left, right];
  const nullable = operands.find(
    (operand) => operand.kind === 'prepared-param-ref' && operand.nullable,
  );
  if (nullable?.kind !== 'prepared-param-ref') return new BinaryExpr(op, left, right);
  if (op === 'eq' || op === 'neq') {
    return new BinaryExpr(op === 'eq' ? 'isNotDistinctFrom' : 'isDistinctFrom', left, right);
  }
  throw ormError(
    'ORM.FILTER_UNSUPPORTED',
    `Structured ORM ${op} comparisons do not support nullable prepared parameter "${nullable.name}"`,
    { meta: { parameter: nullable.name } },
  );
}
