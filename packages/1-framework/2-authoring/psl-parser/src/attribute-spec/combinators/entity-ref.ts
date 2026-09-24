import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type {
  DeclarationFor,
  EntitySelector,
  ResolvedEntityReference,
} from '../../entity-reference';
import { describeResolution, entityReference, matchesSelector } from '../../entity-reference';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, EntityRefArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

function unbound(name: string): never {
  throw new InternalError(
    `The binder on this attribute context bound nothing for "${name}". A reference argument is always examined, so the binder must be built over the same snapshot - the same symbol table and sources - as the interpretation consuming it.`,
  );
}

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
      const binder = ctx.binder;
      if (binder === undefined) {
        throw new InternalError(
          `No binder on this attribute context, so "${name}" cannot be resolved: block attributes carry no entity references, and any that are added must be resolved by the binder over block symbols rather than while their arguments parse.`,
        );
      }
      const resolution = binder.symbolForNode(arg.syntax) ?? unbound(name);
      if (resolution.kind === 'unresolved') return notOk([]);
      const reference = entityReference(resolution);
      if (reference === undefined || !matchesSelector(reference, expected)) {
        return notOk([
          leafDiagnostic(
            ctx,
            arg,
            `Expected ${label} "${name}", found ${describeResolution(resolution)}`,
          ),
        ]);
      }
      return ok(reference);
    },
  };
}
