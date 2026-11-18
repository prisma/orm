import { existsSync } from 'node:fs';
import { join } from 'pathe';

/**
 * Filenames the contract pipeline emits next to the user's schema source
 * (`<schemaDir>/contract.json`, `<schemaDir>/contract.d.ts`, …). Mirrors
 * the schema-dir-relative `ARTIFACT_FILENAMES` in `hygiene-gitattributes.ts`
 * (not that file's migrations-root-anchored store lines, which are outside
 * this command's scope — reinit only ever touches `schemaDir`); kept as a
 * separate constant here because the cleanup contract is target-agnostic
 * and we deliberately do not want a stale artifact from a previous target
 * lingering after a re-init.
 *
 * If a future emit pipeline produces an additional schema-dir artifact,
 * add it here **and** to `ARTIFACT_FILENAMES` in `hygiene-gitattributes.ts`
 * — the two stay in lockstep so the file `init` advertises as
 * `linguist-generated` is exactly the file `init` is willing to delete on
 * re-init.
 */
const ARTIFACT_FILENAMES: readonly string[] = [
  'contract.json',
  'contract.d.ts',
  'ops.json',
  'migration.json',
];

/**
 * Returns the schema-relative paths of stale contract artifacts the
 * previous `init` run (or a `contract emit`) left behind in `schemaDir`.
 * Paths are returned relative to `baseDir` so the caller can plumb them
 * into `filesWritten`-style logging without re-deriving the path.
 *
 * Pure function: no filesystem mutation. Used by `runInit`'s precondition
 * phase (FR6.2 / NFR3 atomicity) so a downstream parse failure leaves
 * the artifacts on disk and the project byte-identical to its pre-init
 * state.
 */
export function findStaleArtifacts(baseDir: string, schemaDir: string): readonly string[] {
  const result: string[] = [];
  for (const filename of ARTIFACT_FILENAMES) {
    const rel = join(schemaDir, filename);
    if (existsSync(join(baseDir, rel))) {
      result.push(rel);
    }
  }
  return result;
}

/**
 * Drops a single key from `package.json#dependencies`, returning the new
 * file content. Returns `null` when the dependency was already absent —
 * the caller can skip the write to keep re-init idempotent (FR9.3).
 *
 * Used by `runInit` for the FR9.2 target-switch path: when the user
 * re-inits a project with a different `--target`, the previous facade is
 * removed from `dependencies` so the resulting project depends only on the
 * chosen target's facade.
 *
 * Devs/peers/optional dep groups are intentionally *not* touched — the
 * facades are only ever in `dependencies` (FR4 / FR7), and broadening
 * the search would risk clobbering an unrelated dep with the same name
 * in `peerDependencies`.
 *
 * Throws `SyntaxError` if `existing` is not parseable as JSON; the
 * caller (`runInit`) already guards on that with a structured 5010
 * error before this helper is reached.
 */
export function removeDependency(existing: string, depName: string): string | null {
  const parsed = JSON.parse(existing) as Record<string, unknown>;
  const deps = parsed['dependencies'];
  if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) {
    return null;
  }
  if (!Object.hasOwn(deps as Record<string, unknown>, depName)) {
    return null;
  }
  const next = { ...(deps as Record<string, unknown>) };
  delete next[depName];
  parsed['dependencies'] = next;
  const trailingNewline = existing.endsWith('\n') ? '\n' : '';
  return `${JSON.stringify(parsed, null, 2)}${trailingNewline}`;
}
