import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { ArgType, BlockInterpretCtx, OutOf } from '../types';
import { leafDiagnostic } from './diagnostic';

export function oneOf<
  Alts extends readonly [
    ArgType<unknown, BlockInterpretCtx>,
    ...ArgType<unknown, BlockInterpretCtx>[],
  ],
>(...alts: Alts): ArgType<OutOf<Alts[number]>, BlockInterpretCtx>;
export function oneOf<Alts extends readonly [ArgType<unknown>, ...ArgType<unknown>[]]>(
  ...alts: Alts
): ArgType<OutOf<Alts[number]>>;
export function oneOf<Alts extends readonly [ArgType<unknown>, ...ArgType<unknown>[]]>(
  ...alts: Alts
): ArgType<OutOf<Alts[number]>> {
  const label = alts.map((alt) => alt.label).join(' | ');
  return {
    kind: 'oneOf',
    label,
    parse: (arg, ctx): Result<OutOf<Alts[number]>, readonly PslDiagnostic[]> => {
      for (const alt of alts) {
        const result = alt.parse(arg, ctx);
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
  };
}
