import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { toExpr } from '@internal/sql-relational-core/expression';

export function predicateExpression(value: unknown): AnyExpression | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof value.buildAst === 'function'
  ) {
    return toExpr(value);
  }
  return undefined;
}
