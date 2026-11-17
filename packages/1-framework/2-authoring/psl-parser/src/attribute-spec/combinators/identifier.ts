import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type {
  AttributeCtx,
  FixedIdentifierArgType,
  IdentifierArgType,
  UnrestrictedIdentifierArgType,
} from '../types';
import { leafDiagnostic } from './diagnostic';

export function identifier(): UnrestrictedIdentifierArgType<AttributeCtx>;
export function identifier<const N extends string>(
  name: N,
  options: { readonly documentation: string },
): FixedIdentifierArgType<N, AttributeCtx>;
export function identifier(
  name?: string,
  options?: { readonly documentation: string },
): IdentifierArgType<string, AttributeCtx> {
  const label = name ?? 'identifier';
  return {
    kind: 'identifier',
    label,
    name,
    documentation: options?.documentation ?? '',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      const value = IdentifierAst.cast(arg.syntax)?.name();
      if (value !== undefined && (name === undefined || value === name)) return ok(value);
      return notOk([leafDiagnostic(ctx, arg, `Expected ${label}`)]);
    },
  };
}
