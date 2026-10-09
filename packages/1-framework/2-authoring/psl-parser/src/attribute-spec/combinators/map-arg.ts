import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import type { ExpressionAst } from '../../syntax/ast/expressions';
import type { ArgType, AttributeCtx } from '../types';

/**
 * `arm`, with the value it parses passed through `map`. The result keeps the arm's `kind`, `label`
 * and metadata, which describe the syntax it accepts for tooling, not its output. A refusal passes
 * through unchanged.
 */
export function mapArg<In, Out, Ctx extends AttributeCtx>(
  arm: ArgType<In, Ctx>,
  map: (value: In, arg: ExpressionAst, ctx: Ctx) => Out,
): ArgType<Out, Ctx> {
  const parse: ArgType<Out, Ctx>['parse'] = (arg, ctx) => {
    const parsed = arm.parse(arg, ctx);
    return parsed.ok ? ok(map(parsed.value, arg, ctx)) : parsed;
  };
  return blindCast<
    ArgType<Out, Ctx>,
    "The arm's metadata does not depend on its output type, but TypeScript cannot carry a spread of the ArgType union over to a new output type."
  >({ ...arm, parse });
}
