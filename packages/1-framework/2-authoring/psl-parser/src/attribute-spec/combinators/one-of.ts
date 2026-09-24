import { blindCast } from '@internal/utils/casts';
import { notOk, or, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type {
  AnyArgType,
  ArgType,
  ContextForRequirement,
  CtxOf,
  OneOfArgType,
  OutOf,
  RequiredContextFor,
} from '../types';
import { leafDiagnostic } from './diagnostic';

export function oneOf<Alts extends readonly [AnyArgType, ...AnyArgType[]]>(
  ...alts: Alts
): OneOfArgType<Alts, ContextForRequirement<RequiredContextFor<CtxOf<Alts[number]>>>> {
  type RequiredContext = RequiredContextFor<CtxOf<Alts[number]>>;
  type ParseContext = ContextForRequirement<RequiredContext>;
  const label = alts.map((alt) => alt.label).join(' | ');
  return {
    kind: 'oneOf',
    label,
    alternatives: alts,
    parse: (arg, ctx): Result<OutOf<Alts[number]>, readonly PslDiagnostic[]> => {
      type Alternative = ArgType<OutOf<Alts[number]>, ParseContext>;
      const [head, ...tail] = blindCast<
        readonly [Alternative, ...Alternative[]],
        'ParseContext is the strongest context every alternative requires and each alternative output is a member of the union, but iterating a heterogeneous tuple erases both relationships.'
      >(alts);
      let rejection = head.parse(arg, ctx);
      if (rejection.ok) return rejection;
      for (const alt of tail) {
        const result = alt.parse(arg, ctx);
        if (result.ok) return result;
        rejection = or(rejection, result);
      }
      if (!rejection.ok && rejection.failure.length === 0) return notOk([]);
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  } satisfies OneOfArgType<Alts, ParseContext>;
}
