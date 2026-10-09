import {
  admittedForms,
  admittedTags,
  castTypedValue,
  type DataTypeSupport,
  describeAdmittedForms,
  describeExpected,
  describeRefusal,
  exactRewrite,
  readWrittenValue,
  tagForm,
  type WrittenForm,
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

/** An argument typed by a data type: any literal, admitted by the ADR 254 cast rule. Used as a parameter of an attribute, a block or a `funcCall`, never as a bare arm of `oneOf`. ADR 231, ADR 254, ADR 268. */
export function dataTypeValue(
  dataType: DataTypeId,
  support: DataTypeSupport,
): DataTypeValueArgType<AttributeCtx> {
  const tags = admittedTags(support, dataType);
  const [firstTag] = tags;
  const forms = admittedForms(support, [dataType]);
  return {
    kind: 'dataTypeValue',
    label:
      firstTag === undefined ? describeAdmittedForms(support, dataType) : tagForm(firstTag).phrase,
    dataType,
    tags,
    documentation: support.entries[dataType]?.documentation ?? '',
    parse: (arg, ctx) => parseDataTypeValue(arg, ctx, dataType, support, forms),
  };
}

function parseDataTypeValue(
  arg: ExpressionAst,
  ctx: AttributeCtx,
  dataType: DataTypeId,
  support: DataTypeSupport,
  forms: readonly WrittenForm[],
): Result<ParsedTypedValue, readonly PslDiagnostic[]> {
  if (!support.lookup.has(dataType)) {
    throw new InternalError(
      `An argument receives data type "${dataType}", which this stack does not register.`,
    );
  }
  if (forms.length === 0) {
    throw new InternalError(
      `An argument receives data type "${dataType}", which nothing in this stack writes.`,
    );
  }
  const refuse = ({ code, message }: { readonly code: string; readonly message: string }) =>
    notOk([leafDiagnostic(ctx, arg, message, code)]);

  const literal = readWrittenScalar(arg);
  if (!literal.ok) {
    return literal.reason === 'not-a-literal'
      ? refuse({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `${describeExpected(forms)}; got ${literal.found}`,
        })
      : refuse({
          code: TAGGED_LITERAL_FAILURE_CODES[literal.reason],
          message: describeTaggedLiteralFailure(literal.reason),
        });
  }

  const read = readWrittenValue(support, literal.written);
  if (!read.ok) {
    return refuse(describeRefusal(read.failure, support, { forms, rewrite: undefined }));
  }

  const cast = castTypedValue(support, dataType, read.value);
  if (!cast.ok) {
    const rewrite = exactRewrite(support, dataType, literal.written);
    return refuse(describeRefusal(cast.failure, support, { forms, rewrite }));
  }

  return ok({
    type: dataType,
    value: cast.value.value,
    span: nodePslSpan(arg.syntax, ctx.sources),
  });
}
