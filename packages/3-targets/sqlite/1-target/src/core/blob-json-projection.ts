import {
  BinaryExpr,
  CaseExpr,
  FunctionCallExpr,
  LiteralExpr,
  type ProjectionExpr,
} from '@internal/sql-relational-core/ast';

/**
 * Projects a blob as a one-element array of its hexadecimal text, and any other value as `otherwise` projects it.
 *
 * SQLite's JSON functions reject a BLOB argument outright, so the encoding has to replace the native conversion rather than post-process it. `hex()` emits uppercase and never wraps. The array is what tells a blob from text: outside a STRICT table a column of any type may hold a blob, and a BLOB column may hold text, which passes through as a row carries it. A codec that reads no bytes receives the array and refuses it, as it refuses the bytes a row carries.
 */
export const hexJsonProjectionOr = (
  expression: ProjectionExpr,
  otherwise: ProjectionExpr,
): ProjectionExpr =>
  CaseExpr.of(
    [
      {
        condition: BinaryExpr.eq(
          FunctionCallExpr.of('typeof', [expression]),
          LiteralExpr.of('blob'),
        ),
        value: FunctionCallExpr.of('json_array', [FunctionCallExpr.of('hex', [expression])]),
      },
    ],
    otherwise,
  );

/** Projects a blob as the one-element array of its hexadecimal text, and any other value unchanged. */
export const hexJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  hexJsonProjectionOr(expression, expression);
