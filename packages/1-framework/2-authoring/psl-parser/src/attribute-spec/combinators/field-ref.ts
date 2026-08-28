import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export type FieldRefScope = 'self' | 'referenced';

export interface FieldRefArgType extends ArgType<string> {
  readonly scope: FieldRefScope;
}

export function fieldRef(scope: FieldRefScope): FieldRefArgType {
  return {
    kind: 'fieldRef',
    label: 'field name',
    scope,
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      const name = IdentifierAst.cast(arg.syntax)?.name();
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a field name')]);
      }
      const model = scope === 'self' ? ctx.selfModel : ctx.resolveReferencedModel();
      // A referenced model in another space can't be resolved here (resolveReferencedModel returns undefined); skip the existence check — it runs where that model is known.
      if (model !== undefined && !Object.hasOwn(model.fields, name)) {
        return notOk([
          leafDiagnostic(ctx, arg, `Field "${name}" does not exist on model "${model.name}"`),
        ]);
      }
      return ok(name);
    },
  };
}
