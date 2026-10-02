import {
  admittedTags,
  castTypedValue,
  type DataTypeSupport,
  describeAdmittedForms,
  describeRefusal,
  printTaggedLiteral,
  readWrittenValue,
  taggedLiteralTextReadsBack,
} from '@internal/framework-components/authoring';
import type { DataTypeId } from '@internal/framework-components/codec';
import { describeTaggedLiteralFailure } from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { nodePslSpan } from '../../resolve';
import type { ExpressionAst } from '../../syntax/ast/expressions';
import { readWrittenScalar } from '../../written-scalar';
import type { AttributeCtx, DataTypeValueArgType, ParsedTypedValue } from '../types';
import { leafDiagnostic } from './diagnostic';

const TAGGED_LITERAL_FAILURE_CODES = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
} as const;

/** An argument typed by a data type: any literal, admitted by the ADR 254 cast rule. Used as a named attribute argument or a block parameter, and as a parameter of a `funcCall`, never as a bare arm of `oneOf`. ADR 231, ADR 254, ADR 260. */
export function dataTypeValue(
  dataType: DataTypeId,
  support: DataTypeSupport,
): DataTypeValueArgType<AttributeCtx> {
  const tags = admittedTags(support, dataType);
  const [firstTag] = tags;
  return {
    kind: 'dataTypeValue',
    label: firstTag === undefined ? describeAdmittedForms(support, dataType) : `${firstTag}\`...\``,
    dataType,
    tags,
    documentation: support.entries[dataType]?.documentation ?? '',
    parse: (arg, ctx) => parseDataTypeValue(arg, ctx, dataType, support, firstTag),
  };
}

function parseDataTypeValue(
  arg: ExpressionAst,
  ctx: AttributeCtx,
  dataType: DataTypeId,
  support: DataTypeSupport,
  firstTag: string | undefined,
): Result<ParsedTypedValue, readonly PslDiagnostic[]> {
  if (!support.lookup.has(dataType)) {
    throw new InternalError(
      `An argument receives data type "${dataType}", which this stack does not register.`,
    );
  }
  const refuse = ({ code, message }: { readonly code: string; readonly message: string }) =>
    notOk([leafDiagnostic(ctx, arg, message, code)]);
  const forms = describeAdmittedForms(support, dataType);

  const literal = readWrittenScalar(arg);
  if (!literal.ok) {
    return literal.reason === 'not-a-literal'
      ? refuse({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `Expected ${forms}, got ${literal.found}`,
        })
      : refuse({
          code: TAGGED_LITERAL_FAILURE_CODES[literal.reason],
          message: describeTaggedLiteralFailure(literal.reason),
        });
  }

  const read = readWrittenValue(support, literal.written);
  if (!read.ok) return refuse(describeRefusal(read.failure, forms));

  const cast = castTypedValue(support, dataType, read.value);
  if (!cast.ok) {
    const rewrite =
      literal.written.kind === 'string' && firstTag !== undefined
        ? rewriteAsTaggedLiteral(firstTag, literal.written.text)
        : forms;
    return refuse(describeRefusal(cast.failure, rewrite));
  }

  return ok({
    type: dataType,
    value: cast.value.value,
    span: nodePslSpan(arg.syntax, ctx.sources),
  });
}

/** What to write instead of a quoted string: the exact literal, when its text reads back unchanged. */
function rewriteAsTaggedLiteral(tag: string, text: string): string {
  return taggedLiteralTextReadsBack(text)
    ? `it as ${printTaggedLiteral(tag, text)}`
    : `it as a ${tag} literal`;
}
