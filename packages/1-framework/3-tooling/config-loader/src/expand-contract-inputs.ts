import { resolve } from 'pathe';
import { glob } from 'tinyglobby';

/**
 * Expands a finalized contract source glob list into its member file set:
 * absolute, deduped by canonical path, sorted. `patterns` must already be
 * absolute (`finalizeConfig` resolves each entry against the config
 * directory but does not expand it); a wildcard-free entry is the degenerate
 * glob and, when it names an existing file, passes through unchanged. A
 * pattern that matches nothing contributes nothing — no diagnostic here.
 */
export async function expandContractInputs(
  patterns: readonly string[] | undefined,
): Promise<readonly string[]> {
  if (patterns === undefined || patterns.length === 0) {
    return [];
  }
  const matches = await glob(patterns, { absolute: true, onlyFiles: true });
  const canonical = new Set(matches.map((match) => resolve(match)));
  return Array.from(canonical).sort();
}
