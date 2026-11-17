import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Read JSON text into the document it holds.
 *
 * `JSON.parse` reads a numeral too large for a double as `Infinity`, and `JSON.stringify` writes
 * that back as `null`, so a document holding one would not be the document stored; it is refused
 * here instead, naming where the number is.
 */
export function parseJsonText(text: string): JsonValue {
  let value: JsonValue;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw structuredError(
      'CONTRACT.INVALID_JSON_LITERAL',
      error instanceof Error ? error.message : String(error),
      { why: 'The text is not a JSON document.', fix: 'Write a JSON document.' },
    );
  }
  const overflowed = nonFiniteNumberIn(value, '');
  if (overflowed !== undefined) {
    throw structuredError(
      'CONTRACT.INVALID_JSON_LITERAL',
      `${overflowed.path} is ${overflowed.value}, which JSON cannot write back: the number in the text is outside the range a JSON number holds.`,
      {
        why: 'JSON.parse reads a numeral too large for a double as Infinity, which JSON.stringify writes back as null.',
        fix: 'Write a number JSON can hold, or write it as text.',
      },
    );
  }
  return value;
}

/** Write a document as the text of a JSON literal. */
export function printJsonText(value: JsonValue): string {
  return JSON.stringify(value);
}

function nonFiniteNumberIn(
  value: JsonValue,
  path: string,
): { readonly path: string; readonly value: number } | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : { path: path === '' ? 'The value' : path, value };
  }
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const found = nonFiniteNumberIn(element, `${path}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) {
      const found = nonFiniteNumberIn(member, path === '' ? key : `${path}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
