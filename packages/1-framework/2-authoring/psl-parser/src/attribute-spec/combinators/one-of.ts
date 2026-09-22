import { blindCast } from '@internal/utils/casts';
import { notOk, ok, or, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type {
  AnyArgType,
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
      const attempt = (alt: Alts[number]): Result<unknown, readonly PslDiagnostic[]> => {
        const parse = blindCast<
          (arg: Parameters<typeof alt.parse>[0], ctx: ParseContext) => ReturnType<typeof alt.parse>,
          'ParseContext is computed as the strongest context required by all alternatives, so it is assignable to every alternative parse context even though TypeScript cannot express that relationship while iterating the heterogeneous tuple.'
        >(alt.parse);
        return parse(arg, ctx);
      };
      const matched = (value: unknown): Result<OutOf<Alts[number]>, readonly PslDiagnostic[]> =>
        ok(
          blindCast<
            OutOf<Alts[number]>,
            'The matched value comes from an alternative whose output type is a member of the union, but iterating the tuple widens each element to ArgType<unknown>, erasing that relationship.'
          >(value),
        );

      const [head, ...tail] = alts;
      let rejection = attempt(head);
      if (rejection.ok) return matched(rejection.value);
      for (const alt of tail) {
        const result = attempt(alt);
        if (result.ok) return matched(result.value);
        rejection = or(rejection, result);
      }
      if (!rejection.ok && rejection.failure.length === 0) return notOk([]);
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  } satisfies OneOfArgType<Alts, ParseContext>;
}
