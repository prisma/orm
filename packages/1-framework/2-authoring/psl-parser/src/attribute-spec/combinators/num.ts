import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, FixedNumArgType, UnrestrictedNumArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** The pinned form retains its value as the output literal type. */
export function num(): UnrestrictedNumArgType<AttributeCtx>;
export function num<const T extends number>(value: T): FixedNumArgType<T, AttributeCtx>;
export function num<const T extends number>(
  value?: T,
): UnrestrictedNumArgType<AttributeCtx> | FixedNumArgType<T, AttributeCtx> {
  if (value === undefined) {
    return {
      kind: 'num',
      label: 'number',
      value: undefined,
      parse: (arg, ctx): Result<number, readonly PslDiagnostic[]> => {
        const literal = NumberLiteralExprAst.cast(arg.syntax);
        if (literal !== undefined) {
          const parsed = literal.value();
          if (parsed !== undefined) return ok(parsed);
        }
        return notOk([leafDiagnostic(ctx, arg, 'Expected a number literal')]);
      },
    };
  }
  return {
    kind: 'num',
    label: String(value),
    value,
    parse: (arg, ctx): Result<T, readonly PslDiagnostic[]> => {
      const literal = NumberLiteralExprAst.cast(arg.syntax);
      if (literal !== undefined) {
        const parsed = literal.value();
        if (parsed === value) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, `Expected ${value}`)]);
    },
  };
}
