import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
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
      for (const alt of alts) {
        const parse = blindCast<
          (arg: Parameters<typeof alt.parse>[0], ctx: ParseContext) => ReturnType<typeof alt.parse>,
          'ParseContext is computed as the strongest context required by all alternatives, so it is assignable to every alternative parse context even though TypeScript cannot express that relationship while iterating the heterogeneous tuple.'
        >(alt.parse);
        const result = parse(arg, ctx);
        if (result.ok) {
          return ok(
            blindCast<
              OutOf<Alts[number]>,
              'The matched value comes from an alternative whose output type is a member of the union, but iterating the tuple widens each element to ArgType<unknown>, erasing that relationship.'
            >(result.value),
          );
        }
      }
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  } satisfies OneOfArgType<Alts, ParseContext>;
}
