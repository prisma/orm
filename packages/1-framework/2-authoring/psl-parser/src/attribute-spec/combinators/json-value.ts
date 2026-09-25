import type { JsonValue } from '@internal/contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import {
  ArrayLiteralAst,
  BooleanLiteralExprAst,
  type ExpressionAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../../syntax/ast/expressions';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, JsonValueArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * Reads a native JSON-compatible literal from the expression AST: strings,
 * numbers, booleans, the `null` identifier, arrays, and object literals,
 * recursively. Any other expression — a non-null identifier, a call, a
 * tagged literal — is a diagnostic, as are duplicate or malformed object
 * fields. Contrast with `json()`, which reads a quoted JSON object string.
 */
export function jsonValue(): JsonValueArgType<AttributeCtx> {
  return {
    kind: 'jsonValue',
    label: 'JSON value',
    parse: (arg, ctx): Result<JsonValue, readonly PslDiagnostic[]> => readJsonValue(arg, ctx),
  };
}

function readJsonValue(
  expr: ExpressionAst,
  ctx: AttributeCtx,
): Result<JsonValue, readonly PslDiagnostic[]> {
  const syntax = expr.syntax;

  const str = StringLiteralExprAst.cast(syntax);
  if (str !== undefined) {
    const value = str.value();
    if (value === undefined) return notOk([leafDiagnostic(ctx, expr, 'Expected a JSON value')]);
    return ok(value);
  }

  const num = NumberLiteralExprAst.cast(syntax);
  if (num !== undefined) {
    const value = num.value();
    if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
      return notOk([leafDiagnostic(ctx, expr, 'Expected a JSON value')]);
    }
    return ok(value);
  }

  const bool = BooleanLiteralExprAst.cast(syntax);
  if (bool !== undefined) {
    const value = bool.value();
    if (value === undefined) return notOk([leafDiagnostic(ctx, expr, 'Expected a JSON value')]);
    return ok(value);
  }

  const identifier = IdentifierAst.cast(syntax);
  if (identifier !== undefined) {
    const name = identifier.name();
    if (name === 'null') return ok(null);
    return notOk([
      leafDiagnostic(ctx, expr, `Expected a JSON value, found identifier "${name ?? ''}"`),
    ]);
  }

  const array = ArrayLiteralAst.cast(syntax);
  if (array !== undefined) {
    const items: JsonValue[] = [];
    const diagnostics: PslDiagnostic[] = [];
    for (const element of array.elements()) {
      const result = readJsonValue(element, ctx);
      if (result.ok) items.push(result.value);
      else diagnostics.push(...result.failure);
    }
    if (diagnostics.length > 0) return notOk(diagnostics);
    return ok(items);
  }

  const object = ObjectLiteralExprAst.cast(syntax);
  if (object !== undefined) {
    const record: Record<string, JsonValue> = {};
    const diagnostics: PslDiagnostic[] = [];
    const seen = new Set<string>();
    for (const field of object.fields()) {
      const key = field.keyName();
      if (key === undefined) {
        diagnostics.push(leafDiagnostic(ctx, field, 'Object field is missing a key'));
        continue;
      }
      if (seen.has(key)) {
        diagnostics.push(leafDiagnostic(ctx, field, `Duplicate object key "${key}"`));
        continue;
      }
      seen.add(key);
      const valueNode = field.value();
      if (valueNode === undefined) {
        diagnostics.push(leafDiagnostic(ctx, field, `Object field "${key}" is missing a value`));
        continue;
      }
      const result = readJsonValue(valueNode, ctx);
      if (result.ok) record[key] = result.value;
      else diagnostics.push(...result.failure);
    }
    if (diagnostics.length > 0) return notOk(diagnostics);
    return ok(record);
  }

  return notOk([leafDiagnostic(ctx, expr, 'Expected a JSON value')]);
}
