import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType, BlockInterpretCtx } from '../types';
import { leafDiagnostic } from './diagnostic';

// An integer literal reduced to its numeric value. Passing `min`/`max` additionally rejects
// out-of-range integers with a distinct range message, leaving the integer-only check intact.
export function int(opts?: { min?: number; max?: number }): ArgType<number, BlockInterpretCtx> {
  const min = opts?.min;
  const max = opts?.max;
  return {
    kind: 'int',
    label: 'integer',
    parse: (arg, ctx): Result<number, readonly PslDiagnostic[]> => {
      const literal = NumberLiteralExprAst.cast(arg.syntax);
      if (literal !== undefined) {
        const value = literal.value();
        if (value !== undefined && Number.isInteger(value)) {
          if ((min === undefined || value >= min) && (max === undefined || value <= max)) {
            return ok(value);
          }
          return notOk([leafDiagnostic(ctx, arg, rangeMessage(min, max))]);
        }
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected an integer literal')]);
    },
  };
}

function rangeMessage(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined)
    return `Expected an integer between ${min} and ${max}`;
  if (min !== undefined) return `Expected an integer greater than or equal to ${min}`;
  return `Expected an integer less than or equal to ${max}`;
}
