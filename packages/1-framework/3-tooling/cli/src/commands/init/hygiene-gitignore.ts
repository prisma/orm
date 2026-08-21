/**
 * The minimal `.gitignore` lines a Prisma Next scaffold needs (FR3.3).
 * Order matches what Node tooling typically writes today.
 *
 * `node_modules/` first because it's the byte-largest miss; `dist/`
 * because the scaffolded `tsconfig.json` writes there; `.env` last so
 * the secret-bearing file is the one most-recently visible in any diff
 * (a paranoid-correct ordering — humans skim from the top).
 */
export const REQUIRED_GITIGNORE_ENTRIES: readonly string[] = ['node_modules/', 'dist/', '.env'];

/**
 * Idempotent `.gitignore` merge (FR3.3 / FR9.3). Returns the new file
 * content given the existing content (or `undefined` if the file does
 * not yet exist). Adds only entries that are not already present and
 * never duplicates a line. Existing comments and blank lines are
 * preserved verbatim — `.gitignore` is parsed by `git` without a tree,
 * so any line modification risks changing semantics.
 *
 * Pattern equivalence is line-literal: `node_modules/` and `node_modules`
 * are treated as different entries. This is intentional — `git` treats
 * them differently (the trailing slash restricts the match to
 * directories), and the AC pins the trailing-slash form.
 *
 * Returns `null` when no changes are required (file already contains
 * every required entry). The caller can use this to decide whether to
 * include `.gitignore` in `filesWritten`.
 */
export function mergeGitignore(existing: string | undefined): string | null {
  if (existing === undefined) {
    return `${REQUIRED_GITIGNORE_ENTRIES.join('\n')}\n`;
  }

  const present = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  const missing = REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) {
    return null;
  }

  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  return `${existing}${separator}${missing.join('\n')}\n`;
}
