import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, NumLiteral, NumLiteralArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** A number literal kept as its source text, for consumers that must not round it through a JS number. */
export function numLiteral(): NumLiteralArgType<AttributeCtx> {
  return {
    kind: 'num',
    label: 'number',
    value: undefined,
    parse: (arg, ctx): Result<NumLiteral, readonly PslDiagnostic[]> => {
      const text = NumberLiteralExprAst.cast(arg.syntax)?.token()?.text;
      if (text !== undefined) return ok({ text });
      return notOk([leafDiagnostic(ctx, arg, 'Expected a number literal')]);
    },
  };
}
