import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { nodePslSpan } from '../../resolve';
import { TaggedLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, ParsedTaggedLiteral, TaggedLiteralArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * A `` tag`...` ``, `tag"..."`, or `tag'...'` argument. `tags` and `documentation` describe the
 * registered tags for tooling; parsing accepts any tag.
 */
export function taggedLiteral(
  tags: readonly string[],
  options: { readonly documentation: string },
): TaggedLiteralArgType<AttributeCtx> {
  return {
    kind: 'taggedLiteral',
    label: `${tags[0] ?? 'tag'}\`...\``,
    tags,
    documentation: options.documentation,
    parse: (arg, ctx): Result<ParsedTaggedLiteral, readonly PslDiagnostic[]> => {
      const literal = TaggedLiteralExprAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a tagged literal')]);
      }
      return ok({
        tag: literal.tagName(),
        canonicalization: literal.canonicalization(),
        span: nodePslSpan(literal.syntax, ctx.sources),
      });
    },
  };
}
