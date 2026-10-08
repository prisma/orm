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
