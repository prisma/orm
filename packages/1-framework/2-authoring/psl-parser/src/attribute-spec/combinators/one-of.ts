import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, or, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { labelIsUnion, UNION_LABEL_SEPARATOR } from '../type-label';
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

/**
 * The first alternative that accepts the argument. When exactly one alternative claims the argument's shape, its result, success or failure, so its diagnostics about the argument are kept.
 */
export function oneOf<Alts extends readonly [AnyArgType, ...AnyArgType[]]>(
  ...alts: Alts
): OneOfArgType<Alts, ContextForRequirement<RequiredContextFor<CtxOf<Alts[number]>>>> {
  type RequiredContext = RequiredContextFor<CtxOf<Alts[number]>>;
  type ParseContext = ContextForRequirement<RequiredContext>;
  for (const alt of alts) {
    if (alt.kind === 'dataTypeValue') {
      throw new InternalError(
        `oneOf was given an arm typed by data type "${alt.dataType}" (${alt.label}). A value of a data type is a parameter of an attribute, a block or a function call, never an arm of oneOf.`,
      );
    }
  }
  const label = alts.map((alt) => alt.label).join(UNION_LABEL_SEPARATOR);
  return {
    kind: 'oneOf',
    label,
    labelIsUnion: alts.length > 1 || labelIsUnion(alts[0]),
    alternatives: alts,
    parse: (arg, ctx): Result<OutOf<Alts[number]>, readonly PslDiagnostic[]> => {
      type Alternative = ArgType<OutOf<Alts[number]>, ParseContext>;
      const [head, ...tail] = blindCast<
        readonly [Alternative, ...Alternative[]],
        'ParseContext is the strongest context every alternative requires and each alternative output is a member of the union, but iterating a heterogeneous tuple erases both relationships.'
      >(alts);
      const claiming = [head, ...tail].filter((alt) => alt.claims?.(arg) === true);
      const [only] = claiming;
      if (only !== undefined && claiming.length === 1) return only.parse(arg, ctx);
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
