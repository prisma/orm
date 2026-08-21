import type { TargetId } from './templates/code-templates';

/**
 * The `.gitattributes` entries written for a freshly initialised project
 * (FR3.4). Mirrors the relevant subset of the repo-root
 * [`.gitattributes`](../../../../../../../../.gitattributes):
 *
 * - **Today**: `contract.json`, `contract.d.ts` are emitted on every
 *   `prisma contract emit`. Marking them `linguist-generated`
 *   keeps GitHub's diff stats honest and collapses the file in code
 *   review by default.
 * - **Forward-looking**: `ops.json`, `migration.json` are not yet emitted
 *   by `init` flows but will be produced by adjacent commands (lower /
 *   migration tooling). Adding them now matches Decision 5
 *   (forward-looking subset) so the file does not need to be amended
 *   every time a new artifact lands.
 *
 * `ARTIFACT_FILENAMES` entries are written relative to the schema
 * directory so a user who runs `init --schema-path db/contract.prisma`
 * gets `db/contract.json linguist-generated` — not the workspace-glob
 * form `<glob>/contract.json` (which would over-match any unrelated
 * `contract.json` the user has elsewhere) and not the absolute
 * `DEFAULT_CONTRACT_SOURCE_DIR/contract.json` (which would silently
 * break for a non-default schema path).
 *
 * The migration contract snapshot store (`migrations/snapshots/<hex>/`)
 * is anchored to the migrations root instead, not the schema directory:
 * migration package depth under `migrations/` varies (`app/<pkg>`,
 * `<space>/<pkg>`, or a bare `<pkg>` in extension source repos), so no
 * single schema-dir-relative pattern can reach every snapshot. See
 * `STORE_GITATTRIBUTES_LINES` below.
 */
const ARTIFACT_FILENAMES: readonly string[] = [
  'contract.json',
  'contract.d.ts',
  'ops.json',
  'migration.json',
];

const ATTRIBUTE = 'linguist-generated';

/**
 * Full `.gitattributes` lines for the migration contract snapshot store,
 * already anchored to the migrations root — unlike `ARTIFACT_FILENAMES`,
 * these are not combined with the schema-relative prefix.
 */
const STORE_GITATTRIBUTES_LINES: readonly string[] = [
  `migrations/snapshots/**/contract.json ${ATTRIBUTE}`,
  `migrations/snapshots/**/contract.d.ts ${ATTRIBUTE}`,
];

/**
 * Computes the `.gitattributes` lines this scaffold expects to own. Each
 * line has the shape `<path> linguist-generated`. The `target` parameter
 * is currently unused but accepted for symmetry with the other hygiene
 * helpers and to leave room for target-specific entries (e.g. a future
 * family-specific artifact) without a signature break.
 */
export function requiredGitattributesLines(
  schemaDir: string,
  _target: TargetId,
): readonly string[] {
  const dir = schemaDir === '.' ? '' : schemaDir.replace(/\/+$/, '');
  const prefix = dir === '' ? '' : `${dir}/`;
  return [
    ...ARTIFACT_FILENAMES.map((file) => `${prefix}${file} ${ATTRIBUTE}`),
    ...STORE_GITATTRIBUTES_LINES,
  ];
}

/**
 * Idempotent `.gitattributes` merge (FR3.4 / FR9.3). Returns the new file
 * content given the existing content (or `undefined` if the file does
 * not yet exist).
 *
 * Equivalence is exact-line: a user-customised line like
 * `prisma/*.json linguist-generated` is *not* recognised as covering
 * `DEFAULT_CONTRACT_SOURCE_DIR/contract.json linguist-generated`. We accept that
 * over-specification — preserving the user's broad pattern *and*
 * appending the narrow one — because the narrow lines are what the
 * acceptance criteria pin (FR3.4 AC).
 *
 * Returns `null` when no changes are required (file already contains
 * every required entry).
 */
export function mergeGitattributes(
  existing: string | undefined,
  required: readonly string[],
): string | null {
  if (existing === undefined) {
    return `${required.join('\n')}\n`;
  }

  const presentLines = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  const missing = required.filter((line) => !presentLines.has(line));
  if (missing.length === 0) {
    return null;
  }

  // Mirrors `mergeGitignore`: a zero-byte existing file would otherwise
  // gain a leading blank line, because `''.endsWith('\n')` is false. The
  // empty-file case is uncommon (most projects either don't have a
  // `.gitattributes` or have one with content), but symmetric handling
  // keeps the two mergers' invariants identical.
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  return `${existing}${separator}${missing.join('\n')}\n`;
}
