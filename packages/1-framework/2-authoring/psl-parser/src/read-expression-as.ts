import {
  admittedForms,
  type DataTypeSupport,
  describeExpected,
  readWrittenValueAs,
} from '@internal/framework-components/authoring';
import type { DataTypeId, DataTypeValue } from '@internal/framework-components/codec';
import { describeTaggedLiteralFailure } from '@internal/framework-components/control';
import type { PslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, type Result } from '@internal/utils/result';
import type { ExpressionAst } from './syntax/ast/expressions';
import { readWrittenScalar } from './written-scalar';

const TAGGED_LITERAL_FAILURE_CODES = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
} as const;

/** Why a written expression is not a value of a data type, worded for a diagnostic at the expression. */
export interface DataTypeValueRefusal {
  readonly code: PslDiagnosticCode;
  readonly message: string;
}

/**
 * Reads `expression` as a value of `dataType`: the literal is read through the authoring entry for its syntax, then taken into `dataType` directly or through a cast it declares. The read every argument typed by a data type takes, in an attribute or a type constructor. ADR 254.
 */
export function readExpressionAs(
  support: DataTypeSupport,
  dataType: DataTypeId,
  expression: ExpressionAst,
): Result<DataTypeValue, DataTypeValueRefusal> {
  if (!support.lookup.has(dataType)) {
    throw new InternalError(
      `An argument receives data type "${dataType}", which this stack does not register.`,
    );
  }
  const forms = admittedForms(support, [dataType]);
  if (forms.length === 0) {
    throw new InternalError(
      `An argument receives data type "${dataType}", which nothing in this stack writes.`,
    );
  }

  const literal = readWrittenScalar(expression);
  if (!literal.ok) {
    return literal.reason === 'not-a-literal'
      ? notOk({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `${describeExpected(forms)}; got ${literal.found}`,
        })
      : notOk({
          code: TAGGED_LITERAL_FAILURE_CODES[literal.reason],
          message: describeTaggedLiteralFailure(literal.reason),
        });
  }

  return readWrittenValueAs(support, dataType, literal.written);
}
