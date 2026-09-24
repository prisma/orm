import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type {
  DeclarationFor,
  EntityLookup,
  EntitySelector,
  ResolvedEntityReference,
} from '../../entity-reference';
import { lookupEntityReference, lookupEntityReferenceInSymbols } from '../../entity-reference';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, EntityRefArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function entityRef<const S extends EntitySelector>(
  expected: S,
): EntityRefArgType<DeclarationFor<S>, AttributeCtx> {
  const label = `${expected.kind === 'block' ? expected.keyword : expected.kind} reference`;
  return {
    kind: 'entityRef',
    label,
    expected,
    parse: (
      arg,
      ctx,
    ): Result<ResolvedEntityReference<DeclarationFor<S>>, readonly PslDiagnostic[]> => {
      const name = IdentifierAst.cast(arg.syntax)?.name();
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, `Expected ${label}`)]);
      }
      const lookup: EntityLookup =
        ctx.binder === undefined
          ? lookupEntityReferenceInSymbols(arg, name, ctx.symbols)
          : lookupEntityReference(arg, ctx.binder);
      if (lookup.kind === 'unresolved') {
        return lookup.voiced
          ? notOk([])
          : notOk([leafDiagnostic(ctx, arg, `Unknown ${label} "${name}"`)]);
      }
      if (lookup.kind === 'notAnEntity') {
        return notOk([
          leafDiagnostic(ctx, arg, `Expected ${label} "${name}", found ${lookup.described}`),
        ]);
      }
      const reference = lookup.reference;
      if (!matchesSelector(reference, expected)) {
        const actual = reference.declaration;
        const kind = actual.kind === 'block' ? actual.keyword : actual.kind;
        return notOk([leafDiagnostic(ctx, arg, `Expected ${label} "${name}", found ${kind}`)]);
      }
      return ok(reference);
    },
  };
}

function matchesSelector<S extends EntitySelector>(
  reference: ResolvedEntityReference,
  expected: S,
): reference is ResolvedEntityReference<DeclarationFor<S>> {
  const declaration = reference.declaration;
  return (
    declaration.kind === expected.kind &&
    (expected.kind !== 'block' ||
      (declaration.kind === 'block' && declaration.keyword === expected.keyword))
  );
}
