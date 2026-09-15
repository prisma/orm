import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, IdentifierArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function identifier<const N extends string>(
  name: N,
  options: { readonly documentation: string },
): IdentifierArgType<N, AttributeCtx> {
  return {
    kind: 'identifier',
    label: name,
    name,
    documentation: options.documentation,
    parse: (arg, ctx): Result<N, readonly PslDiagnostic[]> => {
      const identifier = IdentifierAst.cast(arg.syntax);
      if (identifier !== undefined && identifier.name() === name) return ok(name);
      return notOk([leafDiagnostic(ctx, arg, `Expected ${name}`)]);
    },
  };
}
