import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type {
  DeclarationFor,
  EntitySelector,
  ResolvedEntityReference,
} from '../../entity-reference';
import {
  describeResolution,
  describeWrittenEntityReference,
  entityReference,
  matchesSelector,
  writtenEntityReference,
} from '../../entity-reference';
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
      const written = writtenEntityReference(arg.syntax);
      if (written === undefined) {
        return notOk([leafDiagnostic(ctx, arg, `Expected ${label}`)]);
      }
      const name = describeWrittenEntityReference(written);
      const resolution = ctx.binder.symbolForNode(arg.syntax);
      if (resolution === undefined || resolution.kind === 'unresolved') return notOk([]);
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
