import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A general string literal reduced to its decoded value. Passing `value` pins the
// combinator to that single literal (`str('hashed')` matches only `"hashed"`),
// mirroring how `num(value)`/`identifier(name)` pin their literal. Use the pinned
// form for digit-leading tokens that cannot be bare identifiers.
export function str(): ArgType<string>;
export function str(value: string): ArgType<string>;
export function str(value?: string): ArgType<string> {
  return {
    kind: 'str',
    label: value === undefined ? 'string' : JSON.stringify(value),
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof StringLiteralExprAst) {
        const parsed = arg.value();
        if (parsed !== undefined && (value === undefined || parsed === value)) return ok(parsed);
      }
      const message =
        value === undefined ? 'Expected a string literal' : `Expected ${JSON.stringify(value)}`;
      return notOk([leafDiagnostic(ctx, arg, message)]);
    },
  };
}
