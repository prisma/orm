import type { ResolvedAttribute } from '@internal/psl-parser';
import { parseQuotedStringLiteral } from '@internal/psl-parser';

export { parseQuotedStringLiteral };

/** Storage collection name of a model that declares no `@@map`: the model name, verbatim. */
export function defaultCollectionName(modelName: string): string {
  return modelName;
}

export function getAttribute(
  attributes: readonly ResolvedAttribute[],
  name: string,
): ResolvedAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}
