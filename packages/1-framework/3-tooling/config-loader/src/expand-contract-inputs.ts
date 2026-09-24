import { resolve } from 'pathe';
import { glob, isDynamicPattern } from 'tinyglobby';

/**
 * Expands a finalized contract source input list into its member file set:
 * absolute, deduped by canonical path, sorted. `patterns` must already be
 * absolute (the `orm` config schema resolves each entry against the config
 * file that wrote it but does not expand it).
 *
 * A wildcard-free entry (per tinyglobby's own magic-character check) passes
 * through verbatim — no globbing, no existence check, no directory
 * expansion — so a literal file, a nonexistent path (its read error
 * surfaces downstream), and a directory (`contract-prisma7`'s adoption
 * surface) all reach the result unchanged. Only entries containing glob
 * magic run through `tinyglobby`, directories-not-auto-expanded and
 * files-only; a glob matching nothing contributes nothing — no diagnostic
 * here.
 */
export async function expandContractInputs(
  patterns: readonly string[] | undefined,
): Promise<readonly string[]> {
  if (patterns === undefined || patterns.length === 0) {
    return [];
  }
  const literals: string[] = [];
  const globPatterns: string[] = [];
  for (const pattern of patterns) {
    (isDynamicPattern(pattern) ? globPatterns : literals).push(pattern);
  }
  const globMatches =
    globPatterns.length === 0
      ? []
      : await glob(globPatterns, { absolute: true, onlyFiles: true, expandDirectories: false });
  const canonical = new Set([...literals, ...globMatches].map((entry) => resolve(entry)));
  return Array.from(canonical).sort();
}
