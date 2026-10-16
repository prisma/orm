import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  JsonValue,
} from '@internal/contract/types';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { isStructuredError } from '@internal/utils/structured-error';

export interface DefaultInCanonicalForm {
  readonly value: ColumnDefaultLiteralInputValue;
  /** The canonical form's message for the value, or the first list element, it refuses. */
  readonly refusal: string | undefined;
  /** The refusal is the data type's: it has no literal values at all, so no form of the value is stored. */
  readonly noLiteralValues: boolean;
}

/** The code of a data type's refusal of every literal value, as a raw column's data type refuses them. */
const LITERAL_VALUES_ABSENT = 'CONTRACT.LITERAL_VALUES_ABSENT';

/**
 * A literal default in the canonical form of the column's values (ADR 254), element by element for
 * a list column. A `Date` is read as its ISO text first. A value the form refuses is kept as it is,
 * with the form's message.
 */
export function defaultInCanonicalForm(
  value: ColumnDefaultLiteralInputValue,
  toCanonicalForm: ToCanonicalForm | undefined,
  list: boolean,
): DefaultInCanonicalForm {
  if (toCanonicalForm === undefined) return { value, refusal: undefined, noLiteralValues: false };
  if (list && Array.isArray(value)) {
    const elements = value.map((element) => inCanonicalForm(element, toCanonicalForm));
    return {
      value: elements.map((element) => element.value),
      refusal: elements.find((element) => element.refusal !== undefined)?.refusal,
      noLiteralValues: elements.some((element) => element.noLiteralValues),
    };
  }
  const canonical = inCanonicalForm(
    value instanceof Date ? value.toISOString() : value,
    toCanonicalForm,
  );
  return canonical.refusal === undefined ? canonical : { ...canonical, value };
}

function inCanonicalForm(
  value: JsonValue,
  toCanonicalForm: ToCanonicalForm,
): {
  readonly value: JsonValue;
  readonly refusal: string | undefined;
  readonly noLiteralValues: boolean;
} {
  if (value === null) return { value, refusal: undefined, noLiteralValues: false };
  try {
    return { value: toCanonicalForm(value), refusal: undefined, noLiteralValues: false };
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') {
      return { value, refusal: error.message, noLiteralValues: false };
    }
    if (isStructuredError(error) && error.code === LITERAL_VALUES_ABSENT) {
      return { value, refusal: error.message, noLiteralValues: true };
    }
    throw error;
  }
}

/**
 * The refusal of a contract's literal default that the canonical form of its column's values does
 * not take, with what to do about it: re-emit, for a form an earlier version can have written, or
 * write a SQL expression, for a data type that has no literal values at all.
 */
export function contractDefaultRefusal(
  columnDefault: ColumnDefault | undefined,
  toCanonicalForm: ToCanonicalForm | undefined,
  list: boolean,
): string | undefined {
  if (columnDefault?.kind !== 'literal') return undefined;
  const { refusal, noLiteralValues } = defaultInCanonicalForm(
    columnDefault.value,
    toCanonicalForm,
    list,
  );
  if (refusal === undefined) return undefined;
  if (noLiteralValues) return `The contract holds a literal default. ${refusal}`;
  return `The contract holds this default in a form its data type does not store: ${refusal} Re-emit the contract, then try again.`;
}
