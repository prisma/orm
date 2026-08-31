import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** The pinned form retains its value as the output literal type. */
export function num(): ArgType<number>;
export function num<const T extends number>(value: T): ArgType<T>;
export function num<const T extends number>(value?: T): ArgType<number | T> {
  return {
    kind: 'num',
    label: value === undefined ? 'number' : String(value),
    parse: (arg, ctx): Result<number | T, readonly PslDiagnostic[]> => {
      if (arg instanceof NumberLiteralExprAst) {
        const parsed = arg.value();
        if (parsed !== undefined) {
          if (value === undefined) return ok(parsed);
          if (parsed === value) return ok(value);
        }
      }
      const message = value === undefined ? 'Expected a number literal' : `Expected ${value}`;
      return notOk([leafDiagnostic(ctx, arg, message)]);
    },
  };
}
