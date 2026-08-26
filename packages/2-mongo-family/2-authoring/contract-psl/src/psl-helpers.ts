import type { ResolvedAttribute } from '@internal/psl-parser';
import { parseQuotedStringLiteral } from '@internal/psl-parser';

export { parseQuotedStringLiteral };

export interface ParsedIndexField {
  readonly name: string;
  readonly isWildcard: boolean;
  readonly direction?: 1 | -1;
}

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly ResolvedAttribute[],
  name: string,
): ResolvedAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}
