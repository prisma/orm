import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType, BlockInterpretCtx } from '../types';
import { leafDiagnostic } from './diagnostic';

/** The pinned form retains its value as the output literal type. */
export function str(): ArgType<string, BlockInterpretCtx>;
export function str<const T extends string>(value: T): ArgType<T, BlockInterpretCtx>;
export function str<const T extends string>(value?: T): ArgType<string | T, BlockInterpretCtx> {
  return {
    kind: 'str',
    label: value === undefined ? 'string' : JSON.stringify(value),
    parse: (arg, ctx): Result<string | T, readonly PslDiagnostic[]> => {
      const literal = StringLiteralExprAst.cast(arg.syntax);
      if (literal !== undefined) {
        const parsed = literal.value();
        if (parsed !== undefined) {
          if (value === undefined) return ok(parsed);
          if (parsed === value) return ok(value);
        }
      }
      const message =
        value === undefined ? 'Expected a string literal' : `Expected ${JSON.stringify(value)}`;
      return notOk([leafDiagnostic(ctx, arg, message)]);
    },
  };
}
