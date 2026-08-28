import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A bare model-name reference. Existence of a model with this name is resolved
// downstream (e.g. `resolvePolymorphism`), not here.
export function entityRef(): ArgType<string> {
  return {
    kind: 'entityRef',
    label: 'model name',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      const name = IdentifierAst.cast(arg.syntax)?.name();
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a model name')]);
      }
      return ok(name);
    },
  };
}
