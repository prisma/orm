import type { WrittenScalar } from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import { nodePslSpan } from '../../resolve';
import { readWrittenScalar } from '../../written-scalar';
import type { ArgType, AttributeCtx } from '../types';
import { list } from './list';
import { mapArg } from './map-arg';

/** A literal argument read as a written scalar, with its span. A tagged literal whose text cannot be canonicalized has no `written` value and carries why. */
export type ParsedWrittenScalar =
  | { readonly kind: 'scalar'; readonly written: WrittenScalar; readonly span: PslSpan }
  | {
      readonly kind: 'scalar';
      readonly written: undefined;
      readonly reason: 'nul' | 'too-large';
      readonly span: PslSpan;
    };

/**
 * `arm`, yielding the literal it accepts as a written scalar with its span, so a consumer that reads
 * the value by the cast rule reports at the value. `arm` must accept only literals. The result keeps
 * the arm's `kind` and metadata, which describe the syntax it accepts for tooling, not its output.
 * ADR 231, ADR 254.
 */
export function writtenScalar<Ctx extends AttributeCtx>(
  arm: ArgType<unknown, Ctx>,
): ArgType<ParsedWrittenScalar, Ctx> {
  return mapArg(arm, (_accepted, arg, ctx): ParsedWrittenScalar => {
    const span = nodePslSpan(arg.syntax, ctx.sources);
    const literal = readWrittenScalar(arg);
    if (literal.ok) return { kind: 'scalar', written: literal.written, span };
    if (literal.reason === 'not-a-literal') {
      throw new InternalError(`writtenScalar wraps an arm that accepted ${literal.found}.`);
    }
    return { kind: 'scalar', written: undefined, reason: literal.reason, span };
  });
}

/** A written list with its span, so a refusal about the whole list is reported at it. */
export interface ParsedWrittenList<Element = ParsedWrittenScalar> {
  readonly kind: 'list';
  readonly elements: readonly Element[];
  readonly span: PslSpan;
}

/** A list of the elements `of` yields, with the span of the whole list. ADR 254. */
export function writtenList<Element, Ctx extends AttributeCtx>(
  of: ArgType<Element, Ctx>,
): ArgType<ParsedWrittenList<Element>, Ctx> {
  return mapArg(
    list(of, { label: `list of (${of.label})` }),
    (elements, arg, ctx): ParsedWrittenList<Element> => ({
      kind: 'list',
      elements,
      span: nodePslSpan(arg.syntax, ctx.sources),
    }),
  );
}
