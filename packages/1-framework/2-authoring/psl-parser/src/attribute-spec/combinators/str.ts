import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, FixedStrArgType, UnrestrictedStrArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** The pinned form retains its value as the output literal type. */
export function str(): UnrestrictedStrArgType<AttributeCtx>;
export function str<const T extends string>(value: T): FixedStrArgType<T, AttributeCtx>;
export function str<const T extends string>(
  value?: T,
): UnrestrictedStrArgType<AttributeCtx> | FixedStrArgType<T, AttributeCtx> {
  if (value === undefined) {
    return {
      kind: 'str',
      label: 'string',
      value: undefined,
      parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
        const literal = StringLiteralExprAst.cast(arg.syntax);
        if (literal !== undefined) {
          const parsed = literal.value();
          if (parsed !== undefined) return ok(parsed);
        }
        return notOk([leafDiagnostic(ctx, arg, 'Expected a string literal')]);
      },
    };
  }
  return {
    kind: 'str',
    label: JSON.stringify(value),
    value,
    parse: (arg, ctx): Result<T, readonly PslDiagnostic[]> => {
      const literal = StringLiteralExprAst.cast(arg.syntax);
      if (literal !== undefined) {
        const parsed = literal.value();
        if (parsed === value) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, `Expected ${JSON.stringify(value)}`)]);
    },
  };
}
