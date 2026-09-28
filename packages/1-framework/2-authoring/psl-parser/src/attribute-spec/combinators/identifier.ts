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

export function identifier(options?: {
  readonly allowsUnresolvedName?: boolean;
}): UnrestrictedIdentifierArgType<AttributeCtx>;
export function identifier<const N extends string>(
  name: N,
  options: { readonly documentation: string; readonly allowsUnresolvedName?: boolean },
): FixedIdentifierArgType<N, AttributeCtx>;
export function identifier(
  nameOrOptions?: string | { readonly allowsUnresolvedName?: boolean },
  options?: { readonly documentation: string; readonly allowsUnresolvedName?: boolean },
): IdentifierArgType<string, AttributeCtx> {
  const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined;
  const allowsUnresolvedName =
    (typeof nameOrOptions === 'string' ? options : nameOrOptions)?.allowsUnresolvedName ?? true;
  const label = name ?? 'identifier';
  return {
    kind: 'identifier',
    allowsUnresolvedName,
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
