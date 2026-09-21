import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, EntityRefArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A bare model-name reference. Existence of a model with this name is resolved
// downstream (e.g. `resolvePolymorphism`), not here.
export function entityRef(): EntityRefArgType<AttributeCtx> {
  return {
    kind: 'entityRef',
    label: 'model name',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      const identifier = IdentifierAst.cast(arg.syntax);
      if (identifier === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a model name')]);
      }
      const name = identifier.name();
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a model name')]);
      }
      return ok(name);
    },
  };
}
