import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** The pinned form retains its value as the output literal type. */
export function str(): ArgType<string>;
export function str<const T extends string>(value: T): ArgType<T>;
export function str<const T extends string>(value?: T): ArgType<string | T> {
  return {
    kind: 'str',
    label: value === undefined ? 'string' : JSON.stringify(value),
    parse: (arg, ctx): Result<string | T, readonly PslDiagnostic[]> => {
      if (arg instanceof StringLiteralExprAst) {
        const parsed = arg.value();
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
