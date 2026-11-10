import type { WrittenScalar } from '@internal/framework-components/authoring';
import { describeTaggedLiteralFailure } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok } from '@internal/utils/result';
import {
  ArrayLiteralAst,
  type ExpressionAst,
  TaggedLiteralExprAst,
} from '../../syntax/ast/expressions';
import type { ArgType, AttributeCtx } from '../types';
import { bool } from './bool';
import { leafDiagnostic } from './diagnostic';
import { list } from './list';
import { num } from './num';
import { oneOf } from './one-of';
import { str } from './str';
import { taggedLiteral } from './tagged-literal';

const TAGGED_LITERAL_FAILURE_CODES = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
} as const;

/** A tagged literal as the written value it holds, refused when its text cannot be canonicalized. */
function writtenTaggedLiteral(): ArgType<WrittenScalar, AttributeCtx> {
  const arm = taggedLiteral([], { documentation: "A value written with its data type's tag." });
  const parse: ArgType<WrittenScalar, AttributeCtx>['parse'] = (arg, ctx) => {
    const parsed = arm.parse(arg, ctx);
    if (!parsed.ok) return parsed;
    const { tag, canonicalization } = parsed.value;
    return canonicalization.ok
      ? ok({ kind: 'tag', tag, text: canonicalization.text })
      : notOk([
          leafDiagnostic(
            ctx,
            arg,
            describeTaggedLiteralFailure(canonicalization.reason),
            TAGGED_LITERAL_FAILURE_CODES[canonicalization.reason],
          ),
        ]);
  };
  return blindCast<
    ArgType<WrittenScalar, AttributeCtx>,
    "The arm's metadata does not depend on its output type, but TypeScript cannot carry a spread of the ArgType union over to a new output type."
  >({
    ...arm,
    parse,
    claims: (arg: ExpressionAst) => TaggedLiteralExprAst.cast(arg.syntax) !== undefined,
  });
}

function scalarMemberValue() {
  return oneOf(str(), num(), bool(), writtenTaggedLiteral());
}

/**
 * An enum member's written value: a string, a number, a boolean, a tagged literal, which it yields as the written value, its tag and canonical text, or a list of those. A tagged literal whose text cannot be canonicalized is refused. The block also records each member as written in `writtenValues`, from which the member reader takes it by the cast rule. ADR 254.
 */
export function enumMemberValue() {
  return oneOf(str(), num(), bool(), writtenTaggedLiteral(), {
    ...list(scalarMemberValue(), { label: '[...]' }),
    claims: (arg: ExpressionAst) => ArrayLiteralAst.cast(arg.syntax) !== undefined,
  });
}
