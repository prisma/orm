import type { JsonValue } from '@internal/contract/types';
import { tsStringLiteral } from '@internal/ts-render';

/**
 * Renders a stored value as a TypeScript literal (e.g. `"low"`, `1`, `true`), or `undefined`
 * when the value isn't literal-expressible (objects, arrays, null).
 *
 * Valid **only for codecs whose application value is the stored JSON** (text, int, float, bool). A
 * codec whose application value differs from the stored JSON (e.g. digit text read as a `bigint`)
 * must NOT use this: it renders the application value in its own `renderValueLiteral`.
 */
export function renderTsLiteral(value: JsonValue): string | undefined {
  if (typeof value === 'string') {
    return tsStringLiteral(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

const DECIMAL_INTEGER = /^-?\d+$/;

/** Renders decimal integer text, read as a `number`, as a number literal, or `undefined` for any other value. */
export function decimalTextNumberLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' && DECIMAL_INTEGER.test(value) ? value : undefined;
}

/** Renders decimal integer text, read as a `bigint`, as a bigint literal, or `undefined` for any other value. */
export function decimalTextBigintLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' && DECIMAL_INTEGER.test(value) ? `${value}n` : undefined;
}

/** Renders a float's stored number as a number literal. A target stores an infinity, and NaN where it holds one (SQLite does not), as text, which has no literal type, so it renders nothing. */
export function floatNumberLiteral(value: JsonValue): string | undefined {
  return typeof value === 'number' ? String(value) : undefined;
}
