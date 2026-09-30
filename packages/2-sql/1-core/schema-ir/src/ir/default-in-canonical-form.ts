import type { ColumnDefaultLiteralInputValue, JsonValue } from '@internal/contract/types';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { isStructuredError } from '@internal/utils/structured-error';

export interface DefaultInCanonicalForm {
  readonly value: ColumnDefaultLiteralInputValue;
  /** The data type's message for the value, or the first list element, it refuses. */
  readonly refusal: string | undefined;
}

/**
 * A literal default in the canonical form of the column's data type (ADR 254), element by element
 * for a list column. A `Date` is read as its ISO text first. A value the type refuses is kept as it
 * is, with the type's message.
 */
export function defaultInCanonicalForm(
  value: ColumnDefaultLiteralInputValue,
  toCanonicalForm: ToCanonicalForm | undefined,
  list: boolean,
): DefaultInCanonicalForm {
  if (toCanonicalForm === undefined) return { value, refusal: undefined };
  if (list && Array.isArray(value)) {
    const elements = value.map((element) => inCanonicalForm(element, toCanonicalForm));
    return {
      value: elements.map((element) => element.value),
      refusal: elements.find((element) => element.refusal !== undefined)?.refusal,
    };
  }
  const canonical = inCanonicalForm(
    value instanceof Date ? value.toISOString() : value,
    toCanonicalForm,
  );
  return canonical.refusal === undefined ? canonical : { value, refusal: canonical.refusal };
}

function inCanonicalForm(
  value: JsonValue,
  toCanonicalForm: ToCanonicalForm,
): { readonly value: JsonValue; readonly refusal: string | undefined } {
  try {
    return { value: toCanonicalForm(value), refusal: undefined };
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') {
      return { value, refusal: error.message };
    }
    throw error;
  }
}
