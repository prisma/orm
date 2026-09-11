import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { isExpression } from '@internal/sql-relational-core/expression';

export function predicateExpression(value: unknown): AnyExpression | undefined {
  if (isExpression(value)) {
    return value.buildAst();
  }
  return undefined;
}
